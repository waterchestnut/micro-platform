/**
 * @fileOverview agentTask 恢复的执行方式与扫描判据（纯函数，零依赖）
 * @module services/agent/recoverPolicy
 * @description
 * 这里放两件事：① "恢复要重执行还是重投"（`resolveRecoverMode`）；
 * ② "哪些滞留行算候选"（`buildRecoverFilter` + `DISPATCH_AGENT_TYPES` + `resolveRecoverWindow`）。
 * ②是 2026-11-11 实测之后搬进来的：判据散在 `tasks/` 里时，它同时**不能被单测**、
 * **也不能被运维看清**（那轮实测的结论正是"扫描条件写对了却一条也够不着"）。
 * @description
 * 这个模块存在的理由是**把一个隐含在代码里的环境事实变成显式配置**。
 *
 * 恢复有两种做法：
 * - `direct`：恢复进程里直接 `execAgentTask` 重执行；
 * - `requeue`：把任务重新投回 kafka 的 agentTask topic，由消费者执行。
 *
 * 源仓 2026-11-09 选 `direct` 的依据是一次**本集群实测**：consumer 停摆时重投的消息只堆积不消化。
 * 那是"我们这个环境的消费者当时不工作"，**不是"任何环境的消费者都不工作"**。
 * 把它当成普适事实写进模板，等于让别人的部署继承我们的故障假设。
 *
 * 两种模式都还没有解决的那个问题（记在这里，别让开关制造"已经安全"的错觉）：
 * `handleStatus=0 且滞留超阈值` 这一条**无法区分**"流水线随进程重启蒸发"与"消费者只是排得慢"。
 * 前者重执行是对的，后者会造成**同一任务跑两遍**（agent 任务带真实副作用：生成 PPT、
 * 上传 doc.api、花上游的 token）。要真正安全，需要**每任务的执行认领**
 * （claim/幂等键，§8.3 那条纪律在 agentTask 侧还没落地）。在那之前：
 * - 默认沿用 `direct`（源仓已实测的行为，不偷偷改）；
 * - 其它部署要**按自己的消费者状况显式选择**，而不是继承这个默认。
 */

/** 恢复执行方式 */
export const RECOVER_MODES = {
    /** 恢复进程直接重执行（源仓实测选择：消费者当时停摆） */
    DIRECT: 'direct',
    /** 重新投递 kafka，由消费者执行（消费者健康时更保守的做法） */
    REQUEUE: 'requeue',
}

/** 默认值。写在这里而不是散在调用点，配置缺失时的行为才有唯一解释 */
export const DEFAULT_RECOVER_MODE = RECOVER_MODES.DIRECT

/**
 * @description 解析恢复模式配置
 * @param {Object} [opt] 参数
 * @param {String} [opt.raw] 配置原值（env 读出来是字符串，可能为空/拼错）
 * @param {String} [opt.fallback] 缺省与非法值时的回退，默认 `DEFAULT_RECOVER_MODE`
 * @returns {{mode: String, applied: Boolean, reason: String}} 解析结果与是否走了回退
 *
 * `applied:false` 表示"配置写了但没生效"。本仓有过一次教训：
 * 一个开关因为值被拼错而静默走默认，两周后才从档案发现（配置写了不生效比没写更难查）。
 */
export function resolveRecoverMode({raw = '', fallback = DEFAULT_RECOVER_MODE} = {}) {
    const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (!v) {
        return {mode: fallback, applied: false, reason: 'not-set'}
    }
    const known = Object.values(RECOVER_MODES)
    if (!known.includes(v)) {
        return {mode: fallback, applied: false, reason: `invalid:${v}`}
    }
    return {mode: v, applied: true, reason: 'from-config'}
}

/**
 * @description 该模式下要做什么动作（把"模式"翻译成"动作"，调用点不再写 if 字符串）
 * @param {Object} p 参数
 * @param {String} p.mode resolveRecoverMode 的结果
 * @returns {'exec'|'requeue'} 动作
 */
export function recoverAction({mode = DEFAULT_RECOVER_MODE} = {}) {
    return mode === RECOVER_MODES.REQUEUE ? 'requeue' : 'exec'
}

/**
 * dispatch（派发）型任务的 agentType 名单：**这些行永远不该在这里恢复**。
 *
 * 它们的 `handleStatus=0` 含义是"尚未派发"，由触发方负责；在这里"恢复"等于把整棵任务树重跑一遍。
 *
 * 为什么这条规则必须进**查询**、而不是像以前那样在循环里 `continue`（这是本轮实测出来的改动）：
 * dev 2026-11-11 实测滞留候选 **5211** 条、批次上限 **10**、扫描按 `updateTime` **升序**取前 N，
 * 于是队首被一批永不收敛的派发型行占死（它们不被更新 ⇒ 永远留在队首）。
 * 同一批实测里，近 7 天 103 条滞留行的 `recoverCount` **全是 0**，
 * 恢复轮的收尾日志是 `触发=0, 跳过=0` ——
 * 也就是说**恢复功能自上线以来一条都没救到过**，新滞后的任务排在 5108 条之后根本进不了本轮。
 * 规则写在循环里，对这件事毫无帮助：那 10 个名额已经被占掉了。
 */
export const DISPATCH_AGENT_TYPES = Object.freeze(['sequential', 'parallel', 'dynamic'])

/**
 * 恢复窗口默认值（毫秒）：只救"滞留超过 `recoverStuckMs`、但还没超过本值"的任务。
 *
 * 为什么需要上界（这是上一条修法的配套约束，少了它就是另一个事故）：
 * 把派发型行排掉之后，队首**立刻**换成 2026-03 那批 `grpc/grpcCall` 陈旧行——
 * 下一轮就会真去重执行半年前的任务（外部 gRPC 调用、上游 token、可能还有业务副作用）。
 * 恢复要救的是"进程重启把在途流水线蒸发了"，那是**分钟到小时**级的事件；
 * 一条滞留八个月的行不是"待救"，是"已废弃"，重跑它才是风险。
 *
 * 6 小时这个数不是拍的：实测 2026-11-11 `[30min, 6h]` 区间内滞留行数为 **0**
 * （6–24h 有 22 条、1–7d 有 81 条），所以按这个默认上线时不会触发一次突发重跑。
 */
export const DEFAULT_RECOVER_WINDOW_MS = 6 * 60 * 60 * 1000

/** 滞留判定阈值的默认值（窗口必须比它大，这里给同一个出处，避免两处各写一个 30 分钟） */
export const DEFAULT_RECOVER_STUCK_MS = 30 * 60 * 1000

/**
 * @description 解析"滞留多久以内才值得救"
 * @param {Object} [opt] 参数
 * @param {Number|String} [opt.raw] 配置/入参原值（env 读出来是字符串，可能空、可能拼错）
 * @param {Number} [opt.stuckMs] 滞留判定阈值；窗口必须**大于**它，否则区间为空
 * @param {Number} [opt.fallback] 缺省与非法时的回退值
 * @returns {{windowMs: Number, applied: Boolean, reason: String}} 解析结果与是否走了回退
 *
 * `windowMs <= stuckMs` 是一类特殊的错：它不会报错，只会让扫描条件变成一个**空区间**，
 * 于是恢复轮每十分钟安静地扫到 0 条、日志也一切正常——
 * 和这次查出来的"功能静默失效"是同一个形状。所以这里按"写了没生效"处理并给出原因，
 * 由调用方吵出来，而不是让它悄悄成立。
 */
export function resolveRecoverWindow({raw = '', stuckMs = DEFAULT_RECOVER_STUCK_MS, fallback = DEFAULT_RECOVER_WINDOW_MS} = {}) {
    const stuck = Number(stuckMs) > 0 ? Number(stuckMs) : DEFAULT_RECOVER_STUCK_MS
    const s = raw === null || raw === undefined ? '' : String(raw).trim()
    if (!s) {
        return {windowMs: fallback, applied: false, reason: 'not-set'}
    }
    const n = Number(s)
    if (!Number.isFinite(n) || n <= 0) {
        return {windowMs: fallback, applied: false, reason: `invalid:${s}`}
    }
    if (n <= stuck) {
        return {windowMs: fallback, applied: false, reason: `not-longer-than-stuck:${n}<=${stuck}`}
    }
    return {windowMs: Math.floor(n), applied: true, reason: 'from-config'}
}

/**
 * @description 构造恢复扫描的过滤条件（纯函数，判据只有这一份）
 * @param {Object} [opt] 参数
 * @param {Number} [opt.now] 基准时刻毫秒（默认当前）
 * @param {Number} [opt.stuckMs] 滞留多久算候选
 * @param {Number} [opt.windowMs] 滞留多久以内还值得救
 * @returns {Object} mongo 查询条件（`complexFilter` 直接可用）
 * @throws {Error} 窗口不大于滞留阈值时抛错（空区间不该被当成"今天很干净"）
 *
 * 三个条件各治一个实测到的病：
 * - `handleStatus: 0` + `$lt`：功能本来要救的东西；
 * - `agentType: {$nin: ...}`：治"队首被派发型行占死 ⇒ 新任务永远进不来"；
 * - `$gte`：治"排掉占位者之后，半年前的陈旧行变成队首被真重跑"。
 */
export function buildRecoverFilter({now = Date.now(), stuckMs = DEFAULT_RECOVER_STUCK_MS, windowMs = DEFAULT_RECOVER_WINDOW_MS} = {}) {
    const stuck = Number(stuckMs)
    const win = Number(windowMs)
    if (!(stuck > 0) || !(win > 0)) {
        throw new Error(`recover-scan-invalid-ms:stuck=${stuckMs},window=${windowMs}`)
    }
    if (win <= stuck) {
        throw new Error(`recover-window-not-longer-than-stuck:window=${win}<=stuck=${stuck}`)
    }
    return {
        handleStatus: 0,
        agentType: {$nin: [...DISPATCH_AGENT_TYPES]},
        updateTime: {$lt: new Date(now - stuck), $gte: new Date(now - win)},
    }
}

export default {
    RECOVER_MODES, DEFAULT_RECOVER_MODE, resolveRecoverMode, recoverAction,
    DISPATCH_AGENT_TYPES, DEFAULT_RECOVER_WINDOW_MS, DEFAULT_RECOVER_STUCK_MS, resolveRecoverWindow, buildRecoverFilter,
}
