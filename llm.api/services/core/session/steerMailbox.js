/**
 * @fileOverview 插话 mailbox 的纯判据（PR-D 模型外的输入面；接线在装配批）
 * @module services/core/session/steerMailbox
 * @description
 * §8.1 把"有新输入"分成 answer 与 steer 两条路；steer 走 mailbox（§4.3 line 593：`chat:steer:{runCode}`），
 * 边界注入不重启迭代（soft）或按阶段打断（hard，决策在 llmLoop.steerAction，本件不重定义）。
 * 本件只管**消息进出 mailbox 的形状与队列语义**：
 *   - normalizeSteerMessage：入队把关（说话人必填、mode 枚举**从严**）；
 *   - renderSteeringBlock：边界注入时的上下文文本（§5 line 469：`[插话·李同学] …`）；
 *   - mergeForBoundary：注入前的过期/去重/排序；
 *   - mailboxKey：键契约单点（接线与测试都引用这里，不各自拼字符串）。
 * 刻意**不做**：redis 订阅/子 AbortController/路由（全在装配批）；steerCode 的**生成**（客户端携带或接线层
 * 用 genCode，纯件不猜——方案没定键的形状，定了再补）。
 */

/** §8.1 的两种模式。没有第三种"默认"：mode 决定会不会打断流，猜错的方向都危险 */
export const STEER_MODES = ['soft', 'hard']

const DEFAULT_MAX_TEXT_CHARS = 2000

/**
 * @description mailbox 键（§4.3 line 593 的契约单点）
 * @param {String} runCode 本轮 run 标识（llmChat 侧 = messageCode）
 * @returns {String} 键
 */
export function mailboxKey(runCode) {
    const id = String(runCode || '').trim()
    if (!id) throw new Error('mailboxKey 需要 runCode（无 run 就没有插话的去处）')
    return `chat:steer:${id}`
}

/**
 * @description 入队把关（纯函数）
 * @param {Object} input 客户端投递
 * @param {Object} [opts] {now, maxTextChars}
 * @returns {{ok:Boolean, error?:String, value?:Object, warnings:String[]}} 结果
 *
 * 与 save_artifact 的 kind 不同，**mode 非法是拒不是纠**：把 hard 纠成 soft 该打断没打断，
 * 反过来是无端掐断用户正在看的流——两个方向都比"这一条没收"伤害大。
 * userCode 必填是 §5 line 469 的硬要求（插话必须带说话人，"system 只假设一名用户"的时代已结束）。
 */
export function normalizeSteerMessage(input = {}, opts = {}) {
    const {now = Date.now(), maxTextChars = DEFAULT_MAX_TEXT_CHARS} = opts
    const warnings = []
    const text = String(input.text ?? '').replace(/[\r\n\t\0]+/g, ' ').trim()
    if (!text) return {ok: false, error: 'text 不能为空（空插话只会稀释注意力，没有信息量）', warnings}
    if (text.length > maxTextChars) return {ok: false, error: `插话超过 ${maxTextChars} 字符，请精简后重发`, warnings}
    const mode = String(input.mode ?? 'soft').trim().toLowerCase()
    if (!STEER_MODES.includes(mode)) {
        return {ok: false, error: `mode=${JSON.stringify(input.mode)} 不在 ${STEER_MODES.join('|')}（模式决定打断与否，不做猜测纠正）`, warnings}
    }
    const userCode = String(input.userCode ?? '').trim()
    if (!userCode) {
        return {ok: false, error: 'userCode 必填：插话必须可归因到说话人（§5 line 469）', warnings}
    }
    const realName = String(input.realName ?? '').trim() || userCode
    if (!String(input.realName ?? '').trim()) warnings.push('realName 缺失，展示名回退为 userCode')
    const ts = Number.isFinite(Number(input.ts)) && Number(input.ts) > 0 ? Number(input.ts) : now
    if (Number(input.ts) > now + 5000) warnings.push('ts 在未来 5 秒以上，按服务端当前时间入队')
    const futureSafeTs = Number(input.ts) > now + 5000 ? now : ts
    return {
        ok: true,
        value: {
            steerCode: input.steerCode ? String(input.steerCode) : '',
            text,
            mode,
            userCode,
            realName,
            ts: futureSafeTs,
        },
        warnings,
    }
}

/**
 * @description 边界注入的上下文文本（§5 line 469 的展示契约：`[插话·李同学] …`）
 * @param {Object[]} steers normalizeSteerMessage 通过的条目（按注入顺序）
 * @returns {{block:String, injected:String[]}} 文本与注入的 steerCode 清单（空队 ⇒ block 空串）
 *
 * 防伪造：text 在 normalize 已折行（换行/制表全压成空格），所以**一条插话不可能开出新行**去伪造
 * `[插话·管理员]` 或 `[system]` 前缀——与 constraints 的单行卫生同源，这是本函数逐字插入的前提。
 */
export function renderSteeringBlock(steers = []) {
    const list = (Array.isArray(steers) ? steers : []).filter((s) => s && s.text)
    if (!list.length) return {block: '', injected: []}
    const lines = list.map((s) => `- [插话·${s.realName || s.userCode}] ${s.text}`)
    return {
        block: `## 用户插话（本轮进行中收到，按投递顺序）\n${lines.join('\n')}`,
        injected: list.map((s) => s.steerCode || `anon-${s.ts}`),
    }
}

/**
 * @description 边界消费前的队列整理：过期弃、重复弃、时间升序
 * @param {Object[]} queued 已归一的插话
 * @param {Object} [opts] {now, expiryMs, limit}
 * @returns {{toInject: Object[], dropped: {steerCode:String, reason:String}[]}} 结果
 *
 * 过期默认 10 分钟：run 拖长时边界迟迟不来，**三分钟前用户想改的方向现在可能自己已经说出口了**——
 * 陈旧插话注入比不注入更坏（resume 那条"不得把陈旧消息强行塞进未完成的一轮"同一家规）。
 * limit 防单边界灌入一长串互相矛盾的指令；溢出按时间**新的保留**（旧的更可能已过时）。
 */
export function mergeForBoundary(queued = [], opts = {}) {
    const {now = Date.now(), expiryMs = 10 * 60 * 1000, limit = 5} = opts
    const dropped = []
    const seen = new Set()
    const alive = []
    for (const s of (Array.isArray(queued) ? queued : [])) {
        if (!s || !s.text) continue
        const id = s.steerCode || ''
        if (id && seen.has(id)) {
            dropped.push({steerCode: id, reason: 'duplicate'})
            continue
        }
        if (id) seen.add(id)
        if (Number.isFinite(Number(s.ts)) && now - Number(s.ts) > expiryMs) {
            dropped.push({steerCode: id || `anon-${s.ts}`, reason: 'expired'})
            continue
        }
        alive.push(s)
    }
    alive.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0))
    if (alive.length > limit) {
        const overflow = alive.slice(0, alive.length - limit)
        for (const s of overflow) dropped.push({steerCode: s.steerCode || `anon-${s.ts}`, reason: 'over-limit(旧弃新留)'})
        return {toInject: alive.slice(alive.length - limit), dropped}
    }
    return {toInject: alive, dropped}
}

/**
 * @description steer_ack 事件的载荷形状（§8 事件集合里的 steer_ack；发送时机在装配批）
 * @param {Object} steer 归一后的插话
 * @param {Object} action llmLoop.steerAction 的产物
 * @returns {Object} 事件载荷
 */
export function steerAckPayload(steer, action = {}) {
    return {
        type: 'steer_ack',
        steerCode: steer?.steerCode || '',
        mode: steer?.mode || 'soft',
        injectAt: action.injectAt || 'boundary',
        abortCurrentStream: Boolean(action.abortCurrentStream),
    }
}

/**
 * @description 构造 **run 本地邮箱**（root.js 每 run 建一个；控制通道订阅侧 push，llmChat 边界 pull）
 * @param {Object} [opts] {maxQueue, onAccept}——onAccept(归一后的 steer) 是接受后的旁路通知
 *  （hard 打断的置停止位走它）；回调抛错只计数不反噬入队——旁路消费者坏了不该让唯一的闸吐出来。
 * @returns {{push:Function, pullBoundary:Function, size:Function, stats:Object}} 邮箱
 *
 * 满队列的策略是**挤旧留新**：三条挤一条时，被挤掉的大概率是已被用户改口的旧意图
 * （与 mergeForBoundary 溢出的"新留旧弃"同一裁定）；被挤的如实进 stats.evicted，不静默。
 * push 内部再走一遍 normalize：**入队闸只有一道**，直接 import 本件塞预归一对象的路径不存在，
 * 装配漏线时坏消息在这里被拒而不是在边界上炸主循环。
 */
export function createRunMailbox(opts = {}) {
    const {maxQueue = 20, onAccept = null} = opts
    const stats = {received: 0, rejected: 0, evicted: 0, acceptNotifyErrors: 0}
    const queue = []
    return {
        stats,
        size: () => queue.length,
        /**
         * @description 收一条（原始形态也收：normalize 在这做，坏消息拒收计数不炸）
         * @param {Object} raw 客户端投递的插话（或通道里解出的 payload）
         * @returns {{accepted:Boolean, depth?:Number, error?:String}} 结果
         */
        push(raw) {
            const n = normalizeSteerMessage(raw, {})
            if (!n.ok) {
                stats.rejected++
                return {accepted: false, error: n.error}
            }
            stats.received++
            queue.push(n.value)
            while (queue.length > maxQueue) {
                queue.shift()
                stats.evicted++
            }
            /**
             * 通知只发给**真的还在队里**的：maxQueue=0 这类退化配置下条目刚进就被挤掉，
             * 为一条不存在于任何边界的插话去打断生成，是凭空烧掉一次调用。
             */
            if (typeof onAccept === 'function' && queue[queue.length - 1] === n.value) {
                try {
                    onAccept(n.value)
                } catch {
                    stats.acceptNotifyErrors++
                }
            }
            return {accepted: true, depth: queue.length}
        },
        /**
         * @description 边界取件：过期/去重/限量的裁决全在 mergeForBoundary；
         *  取件后**整队清空**——merge 对队里每一条都已裁决（注入或弃），弃的不留：
         *  留在队里下个边界会被**重新裁决**，"旧弃"的东西就借尸还魂成陈旧注入
         *  （正是过期规则防的那件事）。被弃项如实进 dropped，由接线层记账/回 ack。
         * @param {Object} [pullOpts] mergeForBoundary 的 {now, expiryMs, limit}
         * @returns {{toInject: Object[], dropped: Object[]}} 本次边界的注入清单与弃单
         */
        pullBoundary(pullOpts = {}) {
            const r = mergeForBoundary(queue, pullOpts)
            queue.length = 0
            return r
        },
    }
}

export default {STEER_MODES, mailboxKey, normalizeSteerMessage, renderSteeringBlock, mergeForBoundary, steerAckPayload, createRunMailbox}
