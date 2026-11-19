/**
 * @fileOverview 会话追问轮的"同会话串行"调度判定（PR-任务编排 M1-b 核心，纯函数）
 * @module services/core/session/turnScheduler
 * @description
 * §8.0 纠正的落点：排队的用户追问必须**同 conversationCode 串行**——一个会话同时只能有一个 run，
 * 否则新一轮读不到上一轮完整上下文（正是 `runOverlap` 要防的上下文竞态）。`runOverlap` 今天只会
 * "拒(4291)"或"带 note 放行"，它没有队列、不会等；本件补上"该排队就排队、前一轮终态了再起下一轮"
 * 的调度判定，是 M1-b 相对现状的**增量核心**。
 *
 * 判定与 IO 分离：调用方从账本读 `hasOpenRunOnConversation`/`openRunAgeMs`（跨 worker 权威源同
 * `runOverlap`——用 `llmUsage` 的 processing 行，不用进程表），这里只出决策，可离线穷举。
 *
 * 一条不能省的取舍：**陈旧 open run（多半是被硬杀留下的僵尸行）不能永久锁死一个会话**——
 * 超 `staleMs` 未终态视作"没有活跃 run"放行，与 `runOverlap` "僵尸行不该锁死会话"同口径。
 * 放行时如实带 `contextMissing`，让上层/界面能说明"上一轮可能没完就起了这一轮"。
 */

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

/**
 * @description 新一轮**到达时**的调度：立即跑 or 入队等
 * @param {Object} [p]
 * @param {Boolean} [p.hasOpenRunOnConversation] 该会话是否已有未终态 run
 * @param {Number} [p.openRunAgeMs] 那个未终态 run 已跑多久
 * @param {Number} [p.staleMs] 超过即视作僵尸（放行，不锁死会话）；<=0 用调用方给的判定，缺省 0=不判陈旧
 * @returns {{action:'start'|'queue', contextMissing:Boolean, reason:String}}
 */
export function decideTurnOnArrival({ hasOpenRunOnConversation = false, openRunAgeMs = 0, staleMs = 0 } = {}) {
    if (!hasOpenRunOnConversation) {
        return { action: 'start', contextMissing: false, reason: 'conversation-free' }
    }
    const stale = num(staleMs)
    if (stale > 0 && num(openRunAgeMs) >= stale) {
        // 僵尸 open run：放行但说清上下文可能缺（与 runOverlap stale-open-run 同取向）
        return { action: 'start', contextMissing: true, reason: 'stale-open-run' }
    }
    return { action: 'queue', contextMissing: false, reason: 'previous-turn-active' }
}

/**
 * @description **消费侧**取一条排队轮时判：现在能不能起（同会话串行闸）
 * @param {Object} [p]
 * @param {Boolean} [p.hasOpenRunOnConversation] 同上任一未终态 run 是否存在
 * @param {Number} [p.openRunAgeMs]
 * @param {Number} [p.staleMs]
 * @returns {{start:Boolean, reason:String, contextMissing:Boolean}}
 * @remarks 与 decideTurnOnArrival 共用同一"陈旧不锁死"规则，避免两处漂移；消费侧的 queue=start=false
 *          表示"这条再等等"，不丢（区别于 runOverlap 的直接拒绝）。
 */
export function decideTurnStart(p = {}) {
    const d = decideTurnOnArrival(p)
    return { start: d.action === 'start', reason: d.reason, contextMissing: d.contextMissing }
}

/**
 * @description 路由侧：`runOverlap` **本已判拒**（同会话有活跃轮）时，改成排队还是维持拒绝
 * @param {Object} [p]
 * @param {Boolean} [p.enabled] 队列开关（`limits.conversationTaskQueue.enabled`），关⇒逐字维持现状 4291
 * @param {Boolean} [p.overlapAdmit] `decideOverlap` 的 admit：true⇒本就放行，本件不该插手（维持原路径）
 * @param {String}  [p.overlapReason] `decideOverlap` 的 reason（透传，供日志/审计）
 * @param {Number}  [p.queueCount] 该会话已排队轮数（调用方读，缺省 0）
 * @param {Number}  [p.maxQueue] 该会话排队上限（`<=0` 视为未配⇒不设本层闸，交上层容量闸）
 * @returns {{decision:'pass'|'queue'|'reject', reason:String, code:Number, queuePosition:(Number|null)}}
 * @description
 * 这条只处理 §3.3 读 consumer 后确认的一个真问题：**consumer 不做会话级串行**，
 * `handleStatus:0` 一投 Kafka 就立刻在同一 conversationCode 上跑起来——正是 `runOverlap` 要防的竞态。
 * 所以"排队"绝不能等于"投 queue Kafka"，只能是"落一条 `manual`（持久、不派发）行、返回 queued"；
 * 何时真正执行，是消费侧闸（`decideTurnStart`）+ 排水器的事，不在本判定内。
 *
 * 刻意**不重造陈旧判定**：`decideOverlap` 已把 stale-open-run/unreadable/clock-skew 归为 `admit:true`，
 * 那些情形本件一律 `pass`（维持现网放行路径），只有 `admit:false`（`same-conversation-duplicate`＝上一轮真的还在跑）
 * 才在开关开时转 `queue`。队列上限只作**每会话**廉价护栏；全局在途容量仍归 `taskAdmission`，两处阈值不混为一谈。
 */
export function decideQueueOnOverlap({
    enabled = false, overlapAdmit = true, overlapReason = '', queueCount = 0, maxQueue = 0,
} = {}) {
    // 本就放行 ⇒ 队列逻辑不介入，维持原路径（这是"开关关时逐字不变"的判据基础，与 enabled 无关）
    if (overlapAdmit) {
        return { decision: 'pass', reason: overlapReason || 'overlap-admit', code: 0, queuePosition: null }
    }
    // 本应拒绝且队列关 ⇒ 现网 4291 逐字不变
    if (enabled !== true) {
        return { decision: 'reject', reason: 'queue-disabled', code: 4291, queuePosition: null }
    }
    // 每会话排队护栏：满了才拒（新码 4292，区别于 4291"稍后重试"的即时语义）；未配(<=0)不设本层闸
    const cap = num(maxQueue)
    if (cap > 0 && num(queueCount) >= cap) {
        return { decision: 'reject', reason: 'queue-full', code: 4292, queuePosition: null }
    }
    return { decision: 'queue', reason: 'previous-turn-active', code: 0, queuePosition: num(queueCount) + 1 }
}

/**
 * @description 第二入口（开闸测验实锤的洞）：`decideOverlap` **放行**但理由是 `stale-open-run`
 * （账本行还在 processing、只是过了 1.5s 防重窗口）时，队列要不要接管。
 * @param {Object} [p]
 * @param {Boolean} [p.enabled] 队列总开关（关 ⇒ 恒 pass，现网逐字不变）
 * @param {String} [p.overlapReason] `decideOverlap` 的 reason（只认 stale-open-run，其它放行原因不接管）
 * @param {Number|null} [p.prevHeartbeatAgeMs] 上一轮账本行距上次心跳的毫秒（now - updateTime）；null=读不到
 * @param {Number} [p.queueCount] 该会话已排队轮数
 * @param {Number} [p.maxQueue] 每会话排队上限（<=0 不设本层闸）
 * @param {Number} [p.staleMs] 心跳新鲜阈值（与 `conversationTaskQueue.staleMs` 单源同键：
 *        僵尸 open run 的"多久算死"在两处必须同值，否则一边放行一边接管的边界会互相打脸）
 * @returns {{decision:'pass'|'queue'|'reject', reason:String, code:Number, queuePosition:(Number|null)}}
 * @description
 * 这条补的是 §8.0 的本意：长任务（>1.5s）进行中的追问**该排队而不是并发双跑**——
 * overlap 的 1.5s 窗只防"双击重复发送"，会话串行本来就是队列层的职责（m1b 探针都在窗内连发，
 * 2026-11-19 开闸实测才暴露这个洞：追问被 stale-open-run 放行，同会话两个 run 并发）。
 * 保守面（三种"不确定"一律 pass，与 `runOverlap` "读不懂就放行"同取向）：
 * 心跳读不到 ⇒ pass（"不知道忙不忙"不许拦用户）；心跳超 staleMs ⇒ 僵尸行，维持放行；
 * reason 不是 stale-open-run（no-prev/unreadable-time/clock-skew/note-only）⇒ 不接管。
 */
export function decideQueueOnStaleOpenRun({
    enabled = false, overlapReason = '', prevHeartbeatAgeMs = null, queueCount = 0, maxQueue = 0, staleMs = 45000,
} = {}) {
    if (enabled !== true) {
        return { decision: 'pass', reason: 'queue-disabled', code: 0, queuePosition: null }
    }
    if (overlapReason !== 'stale-open-run') {
        return { decision: 'pass', reason: 'not-stale-open-run', code: 0, queuePosition: null }
    }
    // null/undefined=读不到心跳，**必须先于数值转换判**——Number(null)===0 会把"不知道"
    // 变成"心跳 0 毫秒前刚跳过"（用例抓出来的转换陷阱），不知道就不许当证据排队
    if (prevHeartbeatAgeMs === null || prevHeartbeatAgeMs === undefined) {
        return { decision: 'pass', reason: 'heartbeat-unknown', code: 0, queuePosition: null }
    }
    const hb = Number(prevHeartbeatAgeMs)
    if (!Number.isFinite(hb) || hb < 0) {
        return { decision: 'pass', reason: 'heartbeat-unknown', code: 0, queuePosition: null }
    }
    const stale = num(staleMs) || 45000
    if (hb >= stale) {
        return { decision: 'pass', reason: 'heartbeat-stale', code: 0, queuePosition: null }
    }
    const cap = num(maxQueue)
    if (cap > 0 && num(queueCount) >= cap) {
        return { decision: 'reject', reason: 'queue-full', code: 4292, queuePosition: null }
    }
    return { decision: 'queue', reason: 'previous-turn-active', code: 0, queuePosition: num(queueCount) + 1 }
}

export default { decideTurnOnArrival, decideTurnStart, decideQueueOnOverlap, decideQueueOnStaleOpenRun }
