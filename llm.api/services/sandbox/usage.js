/**
 * @fileOverview 沙箱用量与配额（PR-15 ③）
 * @module services/sandbox/usage
 * @description 池模式与出网策略互斥（§5.24），非池 pod 在 dev 还起不来（§5.25），
 * 但**账本与配额不依赖那两条**：秒数是客户端计时、单价是本地折算，
 * 所以先把"沙箱到底花了多少"这件事变成有数据来源的，`message.totalPrice` 也第一次拿到真实数字。
 *
 * 三处设计取舍：
 * 1. **失败不阻断对话**：账本/配额都走 fail-open（记日志），因为沙箱已经花了就是花了，
 *    为了记账写不进去而把用户的回答打断是本末倒置；配额关在 `sandboxQuota.enabled` 里显式打开。
 * 2. **按 sandboxId 去重**：销毁重试、复用会话多轮都只会有行，不会重复计费。
 * 3. **并发不是查出来的**：本进程登记表（`shared`）才是实时并发来源，跨进程的活跃数 DB 里查不准
 *    （未回收的行 `endedAt` 为 null，但进程崩了它就永远是 null），所以只按窗口秒数配额，
 *    并发上限只对**本进程已登记的会话**生效，并在文档里如实写明这个局限。
 */

/**
 * dac 会连带加载 schema/index.js → 建 Mongo 连接。纯函数（computeSeconds/buildUsageRecord/checkQuota）
 * 必须能离线跑单测，所以这里惰性动态导入 —— 同 §5.21 的分层教训。
 */
let dacMod = null
async function getDac() {
    if (!dacMod) {
        dacMod = await import('../../daos/core/dac/sandboxUsageDac.js')
    }
    return dacMod.default
}

const cfg = () => {
    if (typeof llm === 'undefined') {
        return {}
    }
    return llm.config?.sandboxQuota || {}
}

/**
 * @description 由起止时间算占用秒数（下限 1 秒、上限封顶，防时钟回拨与野值）
 * @author xianyang
 * @param {Number} startedAt 起始毫秒
 * @param {Number} endedAt 结束毫秒
 * @param {Number} [maxSeconds] 单次封顶秒数
 * @returns {Number} 秒数
 */
export function computeSeconds(startedAt, endedAt, maxSeconds = 3600) {
    const cap = Number(maxSeconds) || 3600
    const diff = (Number(endedAt) - Number(startedAt)) / 1000
    if (!Number.isFinite(diff) || diff <= 0) {
        return 1
    }
    /** 下限 1 要防住 0<diff<0.5 的亚秒取整归零（§5.30 真库行 startedAt/endedAt=0.275s 抓出的） */
    return Math.max(1, Math.min(Math.round(diff), cap))
}

/**
 * @description 把一台沙箱的用量折算成一行账本记录
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.sandboxId 沙箱标识
 * @param {String} [params.userCode] 归属用户
 * @param {String} [params.conversationCode] 会话标识
 * @param {String} [params.channel] 频道
 * @param {String} [params.usedFor] 用途：run-code|skill|agent
 * @param {Number} params.startedAt 起始毫秒
 * @param {Number} [params.endedAt] 结束毫秒，缺省取当前
 * @param {String} [params.releaseReason] 回收原因
 * @param {Object} [params.quotaCfg] 覆盖用的配额配置（单测用）
 * @returns {Object} 账本行
 */
export function buildUsageRecord(params = {}) {
    const q = params.quotaCfg || cfg()
    const startedAt = Number(params.startedAt) || Date.now()
    const endedAt = Number(params.endedAt) || Date.now()
    const seconds = computeSeconds(startedAt, endedAt, q.maxSecondsPerSandbox)
    return {
        sandboxId: params.sandboxId,
        userCode: params.userCode || '',
        conversationCode: params.conversationCode || '',
        channel: params.channel || '',
        poolRef: params.poolRef || '',
        usedFor: params.usedFor || 'run-code',
        startedAt: new Date(startedAt),
        endedAt: new Date(endedAt),
        seconds,
        price: round6(seconds * (Number(q.pricePerSecond) || 0)),
        releaseReason: params.releaseReason || 'done',
    }
}

function round6(n) {
    return Math.round((Number(n) || 0) * 1e6) / 1e6
}

/**
 * @description 配额判定（纯函数，方便把边界钉在单测里）
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} [params.quota] 配额配置
 * @param {Number} [params.usedSeconds] 窗口内已用秒数
 * @param {Number} [params.usedSandboxes] 窗口内已用台数
 * @param {Number} [params.activeConversations] 本进程活跃会话沙箱数
 * @param {Number} [params.reserveSeconds] 本次预计占用秒数
 * @returns {Object} {ok, reason, limit, used}
 */
export function checkQuota(params = {}) {
    const q = params.quota || cfg()
    if (!q.enabled) {
        return {ok: true, reason: '', limit: null, used: 0}
    }
    const used = Number(params.usedSeconds) || 0
    const reserve = Number(params.reserveSeconds) || Number(q.reserveSeconds) || 60
    const daily = Number(q.dailySecondsPerUser) || 0
    if (daily > 0 && used + reserve > daily) {
        return {
            ok: false,
            reason: `沙箱配额已用完（窗口内已用 ${used}s，本次预计 ${reserve}s，上限 ${daily}s）`,
            limit: daily,
            used,
        }
    }
    const maxSandbox = Number(q.maxSandboxesPerUser) || 0
    const usedSandbox = Number(params.usedSandboxes) || 0
    if (maxSandbox > 0 && usedSandbox >= maxSandbox) {
        return {
            ok: false,
            reason: `沙箱台数配额已用完（窗口内 ${usedSandbox} 台，上限 ${maxSandbox} 台）`,
            limit: maxSandbox,
            used: usedSandbox,
        }
    }
    const maxActive = Number(q.maxActiveConversations) || 0
    const active = Number(params.activeConversations) || 0
    if (maxActive > 0 && active >= maxActive) {
        return {
            ok: false,
            reason: `活跃沙箱会话已达上限（${active}/${maxActive}，仅统计本进程）`,
            limit: maxActive,
            used: active,
        }
    }
    return {ok: true, reason: '', limit: daily || null, used}
}

/**
 * @description 建箱前的配额闸门；读不到账本就放行（配额是保护措施，不该变成新的故障源）
 * @author xianyang
 * @param {Object} params {userCode, conversationCode}
 * @returns {Promise<Object>} {ok, reason, used}
 */
export async function assertQuota(params = {}) {
    const q = cfg()
    if (!q.enabled) {
        return {ok: true, reason: '', used: 0}
    }
    const userCode = params.userCode || ''
    if (!userCode) {
        return {ok: true, reason: '无 userCode，跳过配额', used: 0}
    }
    let win
    try {
        win = await (await getDac()).sumWindow(userCode, windowStart(q), params.conversationCode || '')
    } catch (e) {
        log('warn', `读沙箱配额失败，放行本次建箱：${e.message}`)
        return {ok: true, reason: '配额读取失败', used: 0}
    }
    const ret = checkQuota({
        quota: q,
        usedSeconds: win.userSeconds,
        usedSandboxes: win.userSandboxes,
        activeConversations: activeCount(),
        reserveSeconds: Number(q.reserveSeconds) || Math.ceil((Number(llm?.config?.sandboxConfig?.defaultTimeoutSeconds) || 600) / 10),
    })
    if (!ret.ok) {
        log('info', `沙箱配额拦截 user=${userCode} 已用=${win.userSeconds}s 原因=${ret.reason}`)
    }
    return {...ret, used: win.userSeconds, convSeconds: win.convSeconds}
}

function windowStart(q = {}) {
    const hours = Number(q.windowHours) || 24
    return new Date(Date.now() - hours * 3600 * 1000)
}

/** 本进程登记的活跃会话沙箱数（由 runner 注入，避免 usage.js 反向依赖 runner 造成环） */
let activeProvider = () => 0
export function setActiveProvider(fn) {
    activeProvider = typeof fn === 'function' ? fn : () => 0
}
function activeCount() {
    try {
        return activeProvider()
    } catch {
        return 0
    }
}

/**
 * @description 落一条用量；失败只告警
 * @author xianyang
 * @param {Object} params 见 buildUsageRecord
 * @returns {Promise<Object|null>} 账本行
 */
export async function recordUsage(params = {}) {
    const rec = buildUsageRecord(params)
    try {
        await (await getDac()).upsertBySandboxId(rec)
        log('info', `沙箱用量已记账 ${rec.sandboxId} ${rec.usedFor} ${rec.seconds}s price=${rec.price}`)
    } catch (e) {
        log('warn', `沙箱用量记账失败 ${rec.sandboxId}：${e.message}`)
    }
    return rec
}

/**
 * @description 本轮会话的沙箱成本（给 message.totalPrice 用）
 *
 * 直接累加账本里已折算好的 price，不再乘一次单价 —— 否则改了单价会让历史记录
 * 与新写入互相打架。取不到就按 0 计，不因为成本核算失败而中断回答。
 * @author xianyang
 * @param {Object} params {conversationCode, windowHours}
 * @returns {Promise<Number>} 本轮沙箱成本
 */
export async function turnSandboxCost(params = {}) {
    const q = cfg()
    if (!params.conversationCode) {
        return 0
    }
    try {
        const since = new Date(Date.now() - (Number(q.windowHours) || 24) * 3600 * 1000)
        const sum = await (await getDac()).sumConversation(params.conversationCode, since)
        return round6(sum.price)
    } catch (e) {
        log('warn', '取本轮沙箱成本失败（按 0 计）：' + e.message)
        return 0
    }
}

function log(level, msg) {
    if (typeof llm === 'undefined' || !llm.logger) {
        return
    }
    llm.logger[level](msg)
}

export default {computeSeconds, buildUsageRecord, checkQuota, assertQuota, recordUsage, setActiveProvider, turnSandboxCost}
