/**
 * @fileOverview 执行认领（execClaim）的 dev 端到端探针：验证"有人在跑时，恢复轮真的不动手"
 * @module evals/platform-probes/exec-claim-probe
 * @description
 * 要验的命题（`docs/session-run-plan.md` §8.3 / §25 v1.84 接线的唯一判据）：
 * **恢复轮取不到认领时必须整条跳过，且不留任何数据痕迹**——尤其是不能把 `recoverCount` 加上去。
 * 那条顺序（先认领、后记数）如果在代码里被反过来，跳过的任务会白烧恢复额度：
 * 它一次都没被救，却用掉了 `maxRecover` 的额度，等它真断时已经没有额度可用。
 * 单元测试钉的是文本顺序，**这条只能在真 mongo + 真 redis + 真 cron 上过**。
 *
 * 为什么用现网 cron 而不是手动 `POST /core/agentTask/recover`：
 * 那个接口是**批量**扫描（一次最多 10 条滞留任务），为了验证我自己的探针而去触发一次，
 * 等于顺手把别人的滞留任务也重执行一遍——那是我用实验之名制造的副作用。
 * 而 `cron/retention.js` 每 10 分钟本来就在跑同一个 `runAgentTaskRecover`，
 * **它就是被测对象本身**：我只要让探针任务落进它的批次，然后读它的日志。
 *
 * 五个阶段（四个是只读的）：
 * - `status`   只读：当前滞留候选有多少条、探针任务排在批次第几（不在前 10 就根本不会被处理）
 * - `insert`   **写**：插一条明确标注的探针任务（`handler: base` 是无外部副作用的具体处理器，
 *              不碰 LLM/沙箱/上传；无 parentCode、无 nextAgentCode ⇒ 不会连锁派发）
 * - `hold`     **占**：用 `execClaim` 本体持有该任务的认领 N 秒（与恢复侧同一资源名、同一取锁路径），
 *              期间按 lease/2 续期；退出时释放
 * - `observe`  只读：探针行的 `recoverCount` / `updateTime` / `handleStatus` + 锁键的**真实 PTTL**
 * - `cleanup`  **删**：删掉探针行与它的 agentLog（实验产物必须可回收，不许留在库里）
 *
 * 用法（在 pod 里跑；配置与凭据由环境给，脚本里没有任何明文秘钥）：
 *   node evals/platform-probes/exec-claim-probe.mjs --phase=status
 *   node evals/platform-probes/exec-claim-probe.mjs --phase=insert --confirm=WRITE
 *   node evals/platform-probes/exec-claim-probe.mjs --phase=hold --seconds=700 --out=/tmp/hold.jsonl
 *   node evals/platform-probes/exec-claim-probe.mjs --phase=observe
 *   node evals/platform-probes/exec-claim-probe.mjs --phase=cleanup --confirm=WRITE
 *
 * 判据的读法（两个时刻对同一行取两次 `observe` 的差）：
 * 1. 持锁期间跨过一个 cron 整点 ⇒ `recoverCount` 与 `updateTime` **都不变**，
 *    且 retention 日志出现 `agentTask 恢复跳过 … recover-need-claim:held`；
 * 2. 释放后再跨一个整点 ⇒ `recoverCount` 变 1、`updateTime` 变成该整点，
 *    日志出现 `恢复触发 … mode=direct` 与 `恢复执行完成 … status=0`。
 * 只做第 1 步不足以说明保护是"因为认领才生效"的——**必须两步都做**，
 * 否则"恢复轮压根没看到这行"（批次没排上、状态不匹配）也长成同一个样子。
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
/**
 * @description 取 --name=value 参数
 * @param {String} n 键
 * @param {String} d 缺省值
 * @returns {String} 值
 */
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const PHASE = val('phase', 'status')
const CONFIRM = val('confirm', '')
const OUT = val('out', '')
const CODE = val('agentCode', '')
const SECONDS = Number(val('seconds', 700))
/** 倒拨分钟数：必须大于 `cron.recoverStuckMs`（默认 30min）才会被当成滞留；默认取 1 天保证排进批次最前 */
const BACKDATE_MIN = Number(val('backdateMin', 24 * 60))
/** 探针任务标识前缀：一眼能看出是探针、且 cleanup 只按这个前缀删（防误删真实任务） */
const PROBE_PREFIX = 'PROBE-CLAIM-'
const LINES = []

/**
 * @description 自己落文件再打印（中文键名不经 PowerShell 重定向，避免编码把读数弄坏）
 * @param {String} note 事件
 * @param {Object} obj 字段
 * @returns {void}
 */
function log(note, obj = {}) {
    const line = JSON.stringify({probe: 'exec-claim', phase: PHASE, note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}

await import('../../init.js')
const {AgentTask, AgentLog} = await import('../../daos/core/schema/index.js')
const agentTaskDac = (await import('../../daos/core/dac/agentTaskDac.js')).default
const claim = await import('../../services/agent/execClaim.js')
const policy = await import('../../services/agent/recoverPolicy.js')

const config = llm.config
const STUCK_MS = Number(config.cron?.recoverStuckMs) || 1800000
const BATCH = Number(config.cron?.recoverBatch || 10)

/**
 * @description 找探针行（没给 agentCode 时按前缀找最新一条）
 * @returns {Promise<Object|null>} 探针任务行
 */
async function findProbeRow() {
    const filter = CODE
        ? {agentCode: CODE}
        : {agentCode: {$regex: `^${PROBE_PREFIX}`}}
    const rows = await AgentTask.find(filter).sort({insertTime: -1}).limit(1).lean().exec()
    return rows[0] || null
}

/**
 * @description 读滞留候选与批次位置
 * 判据**必须取策略层那一份**（`buildRecoverFilter`）：本探针上一版自己复刻了一遍扫描条件，
 * 于是 `tasks/` 那边改了窗口之后这里还在报旧口径的批次，读数会把实验引到错误的结论上——
 * 同一个坑我这轮刚在恢复任务里填过一次。
 * @param {String} agentCode 探针任务标识
 * @returns {Promise<Object>} 读数
 */
async function readBacklog(agentCode) {
    const windowResolved = policy.resolveRecoverWindow({raw: config.cron?.recoverWindowMs, stuckMs: STUCK_MS})
    const filter = policy.buildRecoverFilter({stuckMs: STUCK_MS, windowMs: windowResolved.windowMs})
    const total = await AgentTask.countDocuments({status: {$ne: -1}, ...filter})
    const batch = await agentTaskDac.getTop(BATCH, {
        complexFilter: filter,
    }, {updateTime: 1})
    const list = batch || []
    const rank = agentCode ? list.findIndex(r => r.agentCode === agentCode) : -1
    const stale = await agentTaskDac.getCount({
        complexFilter: {
            handleStatus: 0,
            agentType: {$nin: [...policy.DISPATCH_AGENT_TYPES]},
            updateTime: {$lt: filter.updateTime.$gte},
        },
    })
    return {
        窗口内候选总数: total,
        窗口外滞留: stale,
        本轮批次条数: list.length,
        批次上限: BATCH,
        恢复窗口ms: windowResolved.windowMs,
        探针是否在批次内: rank >= 0,
        批次内位次: rank,
        /** 只给标识与类型，不给 params（可能含业务数据） */
        批次内容: list.map((r, i) => `${i}:${r.agentCode}/${r.agentType}/${r.handler}/${r.updateTime ? new Date(r.updateTime).toISOString() : '-'}`),
    }
}

/**
 * @description 读锁键在 redis 里的真实剩余时间（PTTL）
 * @param {String} agentCode 任务标识
 * @returns {Promise<Object>} 读数；拿不到客户端时如实报 unknown
 */
async function readLockTtl(agentCode) {
    try {
        const redlock = await (await import('../../daos/redlock.js')).default
        const client = redlock?.clients?.values?.().next?.().value
        if (!client || typeof client.pttl !== 'function') {
            return {锁键PTTL: 'unknown(无可用客户端)'}
        }
        const key = claim.claimResource(agentCode)
        const pttl = await client.pttl(key)
        /** 只读键是否存在，不读值：值是 redlock 的随机令牌，打出来没有判据意义 */
        return {锁键: key, 锁键PTTL: pttl, 含义: pttl === -2 ? '键不存在' : (pttl === -1 ? '存在但无过期时间(异常)' : `剩余${pttl}ms`)}
    } catch (e) {
        return {锁键PTTL: `unknown(${String(e?.message || e).slice(0, 60)})`}
    }
}

if (PHASE === 'status') {
    const row = await findProbeRow()
    /**
     * 没有探针行时**也要**把滞留面打出来：这是决定实验可不可能被观测到的前提
     * （批次只有 10 条，若现网已有 10 条更老的滞留任务，探针根本进不了本轮，
     * 那么"恢复跳过了"就会是假的因果——它压根没看到这行）。
     */
    log('现网滞留面', {
        滞留阈值ms: STUCK_MS,
        恢复模式: config.cron?.recoverMode || '(未配置→策略层默认)',
        租约ms: Number(config.agentTask?.execLeaseMs) || claim.DEFAULT_LEASE_MS,
        探针行: row ? row.agentCode : '(不存在)',
        ...(await readBacklog(row ? row.agentCode : '')),
    })
} else if (PHASE === 'window') {
    /**
     * 只读：按"滞留多久"分桶，给恢复窗口量一个**有据可依**的默认值。
     * 为什么必须先量：把派发型行从查询里排掉之后，队首会立刻换成 2026-03 那批陈旧 grpc 任务，
     * 下一轮就会真去重跑它们（外部 gRPC 调用 + 上游 token）——那等于用"修复"制造事故。
     * 窗口下沿（30min）之上再压一个上沿，才是"救刚被发版打断的任务"这件本意。
     */
    const nowMs = Date.now()
    /**
     * @description 把"多少分钟前"换成可读时刻
     * @param {Number} m 毫秒
     * @returns {String} ISO 摘要
     */
    const ago = (m) => new Date(nowMs - m).toISOString().slice(0, 16) + 'Z'
    const DISPATCH_TYPES = ['sequential', 'parallel', 'dynamic']
    const BUCKETS = [[30, 60], [60, 180], [180, 360], [360, 1440], [1440, 10080]]
    const buckets = []
    for (const [fromMin, toMin] of BUCKETS) {
        const base = {
            status: {$ne: -1}, handleStatus: 0,
            updateTime: {$gte: new Date(nowMs - toMin * 60000), $lt: new Date(nowMs - fromMin * 60000)},
        }
        const total = await AgentTask.countDocuments(base)
        const rows = await AgentTask.find(base).select({agentType: 1, handler: 1, tags: 1}).limit(500).lean().exec()
        const byType = {}
        for (const r of rows) {
            const rc = (r.tags || []).find(t => t.key === 'recoverCount')?.value || '0'
            const k = `${r.agentType}/${r.handler}#rc${rc}`
            byType[k] = (byType[k] || 0) + 1
        }
        buckets.push({
            滞留区间: `${fromMin}~${toMin}分钟前`,
            时刻: `${ago(toMin * 60000)}→${ago(fromMin * 60000)}`,
            条数: total,
            其中非派发型: rows.filter(r => !DISPATCH_TYPES.includes(r.agentType)).length,
            抽样构成: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}×${v}`),
        })
    }
    log('滞留时长按桶分布', {批次上限: BATCH, 滞留阈值ms: STUCK_MS, 样本上限: 500, 桶: buckets})
} else if (PHASE === 'backlog') {
    /**
     * 只读：把"恢复轮看得见多少 / 够得着多少"分开口径算清楚。
     * 起因是 `status` 实测到滞留候选 5211 条而批次上限只有 10：
     * 扫描按 `updateTime` **升序**取前 N，所以只要有一批永不收敛的陈旧行占住队首，
     * **新滞后的任务就永远进不了本轮**——恢复功能会静默失效，而日志看起来一切正常。
     * 这不是推测：下面的 `够得着的条数` 与 `队首被谁占着` 就是判据。
     */
    const cutoff = new Date(Date.now() - STUCK_MS)
    const windowFrom = new Date(Date.now() - Number(val('windowDays', 7)) * 86400000)
    const DISPATCH = policy.DISPATCH_AGENT_TYPES
    /**
     * 本阶段是**诊断镜头**，故意比恢复轮宽（要看全貌），所以每个数字都标了自己的口径；
     * 而"本轮实际看得见几条"必须用策略层那份判据算，不能在这里另写一套——
     * 上一版这处复刻了旧条件，窗口修好后就会报出与现网不同的批次，读数会把人带偏。
     */
    const liveWindow = policy.resolveRecoverWindow({raw: config.cron?.recoverWindowMs, stuckMs: STUCK_MS})
    const liveFilter = policy.buildRecoverFilter({stuckMs: STUCK_MS, windowMs: liveWindow.windowMs})
    const liveBatch = await agentTaskDac.getTop(BATCH, {complexFilter: liveFilter}, {updateTime: 1})
    const byType = await AgentTask.aggregate([
        {$match: {status: {$ne: -1}, handleStatus: 0, updateTime: {$lt: cutoff}}},
        {$group: {_id: {agentType: '$agentType', handler: '$handler'}, n: {$sum: 1}, oldest: {$min: '$updateTime'}, newest: {$max: '$updateTime'}}},
        {$sort: {n: -1}},
        {$limit: 20},
    ]).allowDiskUse(true).exec()
    const recoverable = await AgentTask.countDocuments({
        status: {$ne: -1}, handleStatus: 0, updateTime: {$lt: cutoff},
        agentType: {$nin: [...DISPATCH]},
        /** 恢复次数没烧完的才算"可救"（tags 是子文档数组，这里用元素级 $elemMatch） */
        $or: [
            {tags: {$exists: false}},
            {tags: {$size: 0}},
            {tags: {$not: {$elemMatch: {key: 'recoverCount', value: {$in: ['2', '3', '4', '5', '6', '7', '8', '9']}}}}},
        ],
    })
    const reachable = await AgentTask.countDocuments({
        status: {$ne: -1}, handleStatus: 0, updateTime: {$lt: cutoff, $gte: windowFrom},
    })
    const total = await AgentTask.countDocuments({status: {$ne: -1}, handleStatus: 0, updateTime: {$lt: cutoff}})
    log('滞留面构成', {
        批次上限: BATCH,
        滞留阈值ms: STUCK_MS,
        '滞留总数(诊断口径:全部年龄段非删除行)': total,
        '非派发型且额度未烧完(诊断口径:不限年龄)': recoverable,
        [`近${val('windowDays', 7)}天内的滞留条数(诊断口径)`]: reachable,
        '本轮实际看得见(现网口径:窗口内+排派发型)': (liveBatch || []).length,
        现网恢复窗口ms: liveWindow.windowMs,
        按类型: byType.map(b => `${b._id.agentType}/${b._id.handler}×${b.n}(最旧${b.oldest ? new Date(b.oldest).toISOString().slice(0, 10) : '-'}~最新${b.newest ? new Date(b.newest).toISOString().slice(0, 10) : '-'})`),
    })
} else if (PHASE === 'insert') {
    if (CONFIRM !== 'WRITE') {
        log('拒绝写库', {原因: '缺 --confirm=WRITE'})
        process.exit(2)
    }
    const now = new Date()
    const agentCode = `${PROBE_PREFIX}${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
    const backdated = new Date(now.getTime() - BACKDATE_MIN * 60 * 1000)
    /**
     * `handler: base` 是具体可用的无副作用处理器（`services/agent/handler/base.js` 只返回结构体，
     * 不碰 LLM/沙箱/上传）；`agentType: local` 不在恢复侧跳过的 dispatch 名单里；
     * 不给 parentCode/nextAgentCode ⇒ 执行完不会链式派发。
     * `updateTime` 显式倒拨：schema 的默认值只在字段缺失时生效，`add()` 是 `new Model().save()`。
     */
    const doc = await agentTaskDac.add({
        agentCode,
        title: '探针-执行认领验证（实验用后可删）',
        agentType: 'local',
        handler: 'base',
        handleStatus: 0,
        handleMode: 'queue',
        errorMode: 'break',
        status: 0,
        operator: {userCode: 'PROBE', userName: '执行认领探针'},
        tags: [],
        insertTime: now,
        updateTime: backdated,
    })
    const backlog = await readBacklog(agentCode)
    log('已插入探针任务', {
        agentCode: doc.agentCode,
        倒拨到: backdated.toISOString(),
        会被视为滞留: backdated.getTime() < Date.now() - STUCK_MS,
        ...backlog,
    })
    if (!backlog.探针是否在批次内) {
        log('警告：探针没进本轮批次', {处置: '增大 --backdateMin 让它排到最前，否则实验观测不到'})
    }
} else if (PHASE === 'observe') {
    const row = await findProbeRow()
    if (!row) {
        log('探针行不存在', {说明: 'insert 没做或已被 cleanup'})
        process.exit(2)
    }
    const recoverCount = Number((row.tags || []).find(t => t.key === 'recoverCount')?.value || 0)
    log('探针行现状', {
        agentCode: row.agentCode,
        handleStatus: row.handleStatus,
        recoverCount,
        updateTime: new Date(row.updateTime).toISOString(),
        insertTime: new Date(row.insertTime).toISOString(),
        /** 恢复轮动过这行的判据：updateTime 被推后（它一次 update 都会自动盖时间） */
        距上次更新分钟: Math.round((Date.now() - new Date(row.updateTime).getTime()) / 60000),
        ...(await readLockTtl(row.agentCode)),
        ...(await readBacklog(row.agentCode)),
    })
} else if (PHASE === 'hold') {
    const row = await findProbeRow()
    if (!row) {
        log('没有可持有的探针行', {说明: '先跑 insert'})
        process.exit(2)
    }
    const leaseMs = Number(val('lease', 300000))
    const got = await claim.acquireClaim({agentCode: row.agentCode, leaseMs})
    log('取认领', {agentCode: row.agentCode, state: got.state, reason: got.reason, ms: got.ms, leaseMs})
    if (got.state !== 'granted') {
        /**
         * 拿不到锁就不该继续：那说明另有持有者（可能是恢复轮或真实执行者）。
         * 硬撑下去会得到"我以为我在持锁，其实没有"的实验结论——比不做实验更糟。
         */
        log('中止：未能持有认领', {原因: got.reason})
        process.exit(3)
    }
    let lock = got.lock
    const until = Date.now() + SECONDS * 1000
    let ticks = 0
    while (Date.now() < until) {
        await new Promise(r => setTimeout(r, 10000))
        ticks++
        if (claim.shouldRenew({sinceRenewMs: 10000 * ticks, leaseMs})) {
            const e = await claim.extendClaim({lock, leaseMs})
            if (!e.ok) {
                log('续期失败，停止持有', {reason: e.reason})
                break
            }
            lock = e.lock || lock
            ticks = 0
            log('已续期', {剩PTTL: (await readLockTtl(row.agentCode)).锁键PTTL})
        }
    }
    const rel = await claim.releaseClaim({lock, logger: llm.logger})
    log('已释放', {reason: rel.reason, ...(await readLockTtl(row.agentCode))})
} else if (PHASE === 'cleanup') {
    if (CONFIRM !== 'WRITE') {
        log('拒绝删除', {原因: '缺 --confirm=WRITE'})
        process.exit(2)
    }
    const rows = CODE
        ? [await AgentTask.findOne({agentCode: CODE}).lean().exec()]
        : await AgentTask.find({agentCode: {$regex: `^${PROBE_PREFIX}`}}).lean().exec()
    const targets = rows.filter(Boolean)
    /**
     * 只删前缀命中的行：这是"实验产物必须可回收"与"实验不许碰真实数据"之间唯一的边界，
     * 所以宁可漏删（还能手工补）也不能放宽匹配条件。
     */
    const codes = targets.map(r => r.agentCode).filter(c => String(c).startsWith(PROBE_PREFIX))
    if (codes.length !== targets.length) {
        log('已剔除不匹配前缀的标识', {原始: targets.length, 保留: codes.length})
    }
    for (const c of codes) {
        const t = await AgentTask.deleteOne({agentCode: c}).exec()
        const g = await AgentLog.deleteMany({agentCode: c}).exec()
        log('已删除', {agentCode: c, 任务行: t.deletedCount, 日志行: g.deletedCount, ...(await readLockTtl(c))})
    }
    if (!codes.length) {
        log('没有探针行需要清理')
    }
} else {
    log('未知阶段', {PHASE, 可用: ['status', 'window', 'backlog', 'insert', 'hold', 'observe', 'cleanup']})
    process.exit(2)
}
process.exit(0)
