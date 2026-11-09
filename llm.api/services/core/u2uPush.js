/**
 * @fileOverview u2u 实时推送（redis pub/sub）的扇出与判定
 * @module services/core/u2uPush
 * @description
 * **这条链现状是断的，而断法比"没实现"更糟**（v1.30 实测取证）：
 * - 服务端：`u2uChat.js` 里 `publishU2uEvent` 的定义与两处调用点**自首提交 `7051b67` 起就整段被注释**
 *   ⇒ 发消息/已读事件从来不进 redis；
 * - 前端：`xxzx.console/src/pages/Chat/u2u.tsx:678-679` 收到 `connected` 就置
 *   `connectedRef.current = true`，而 `:728` 的轮询兜底是
 *   `if (connectedRef.current) return;`
 *   ⇒ **页面开着、流连着的时候，轮询被自己的连接关掉了，而推送又永远不会来**。
 *   用户看到的不是"稍延迟"，是**对方的新消息在页面保持打开期间根本不出现**，
 *   要等断线重连失败退回轮询、或手动刷新。
 *
 * 所以本模块是**缺陷修复**，不是新功能。两点让它能被前端安全接受：
 * 1. 前端 `appendMessages`（`u2u.tsx:551-553`）按 `messageCode` 去重 ⇒ 推送与轮询共存不会重复显示；
 * 2. 推送**按接收人各发一份**：`fromMe` 是"按人算"的字段，发一份通用 payload 会让
 *    群聊里"谁的话"错位（前端 1056/1292 行靠它决定气泡左右）。
 *
 * 扇出失败**绝不阻断业务动作**：消息已经落库，推送失败只该记日志——
 * 让"通知没送到"把"消息发出去了"变成"发送失败"，是拿确定的伤害去换不确定的收益。
 */

/** redis 频道命名：`u2u:msg:<userCode>`（与 routes/core/chat/u2u.js 的订阅端必须一致） */
export const U2U_CHANNEL_PREFIX = 'u2u:msg:'

/**
 * @description 算出该推送给谁：会话成员去掉操作者本人
 * @param {String[]} userCodes 会话成员
 * @param {String} actorCode 本轮操作者（发消息或标已读的人）
 * @returns {String[]} 目标工号（去重、去空、不含自己）
 * @description
 * 排除自己是必须的：不排除，用户每发一条消息都会收到自己的一份推送，
 * 前端虽然按 messageCode 去重不会重复显示，但会多一次 `readU2uMessages` 调用与一次游标跳动。
 */
export function u2uPushTargets(userCodes = [], actorCode = '') {
    return [...new Set((userCodes || []).filter(u => u && u !== actorCode))]
}

/**
 * @description 构造一个推送事件（payload 由调用方按人给出，避免把"谁的视角"烤进公共数据）
 * @param {String} conversationCode 会话标识
 * @param {String} event 事件名：message | read
 * @param {Object} data 该接收人看到的数据
 * @returns {{event: String, conversationCode: String, data: Object, timestamp: String}} 事件
 */
export function buildU2uEvent(conversationCode, event, data) {
    return {event, conversationCode, data, timestamp: new Date().toISOString()}
}

/**
 * @description 扇出：对每个目标发一份，单个失败不影响其余，整体绝不抛错
 * @param {Object} params 参数
 * @param {Function} params.publish `(channel, message) => Promise<Number|void>`（注入以便离线测）
 * @param {String[]} [params.targets] 目标工号
 * @param {Function} params.dataFor `(userCode) => Object` 该接收人的 payload
 * @param {String} params.conversationCode 会话标识
 * @param {String} params.event 事件名
 * @param {Function} [params.log] 日志器
 * @returns {Promise<{attempted: Number, succeeded: Number, failed: Number, reasons: String[]}>} 结果
 */
export async function fanoutU2uEvent({
    publish,
    targets = [],
    dataFor,
    conversationCode,
    event,
    log = null,
} = {}) {
    const ret = {attempted: 0, succeeded: 0, failed: 0, reasons: []}
    if (typeof publish !== 'function' || !targets.length) {
        return ret
    }
    for (const userCode of targets) {
        ret.attempted++
        try {
            await publish(U2U_CHANNEL_PREFIX + userCode, JSON.stringify(buildU2uEvent(conversationCode, event, dataFor(userCode))))
            ret.succeeded++
        } catch (e) {
            /** 失败只记数不抛：消息已落库，通知没送到不该把发送变成失败 */
            ret.failed++
            const reason = String(e?.message || e).slice(0, 120)
            ret.reasons.push(`${userCode}:${reason}`)
            log?.warn?.(`u2u 推送失败(${event}, ${userCode}): ${reason}`)
        }
    }
    return ret
}
