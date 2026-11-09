/**
 * @fileOverview 消息列表的可见性范围收敛（纯函数）
 * @module services/core/messageScope
 * @description
 * 单独成模块的原因：`services/core/message.js` 顶层会 import dac，而 dac 经
 * `daos/core/schema/index.js` 的顶层 `await createConnection` 直接连库 ⇒ 放在那里就没法离线单测。
 * 这里保持零依赖（只用 tools），把"谁能看哪些会话的消息"这条安全判定变成可穷举测试的纯函数。
 *
 * 口径（D51/D55）：**按会话成员制**，不是按消息作者。
 * 成员制的既有实现是 `conversationDac.assembleParams` 里的
 * `$or: [{userCodes: 我}, {'operator.userCode': 我}]`，本函数消费它的结果集。
 */

import * as tools from '../../tools/index.js'

/**
 * @description 把"请求的会话范围"收敛到"当前用户可见的会话范围"
 * @author menglb
 * @param {Object} filter 调用方给的筛选条件（来自请求体，不可信）
 * @param {String} userCode 当前登录用户标识
 * @param {String[]} allowedCodes 该用户按成员制可见的会话标识集合
 * @returns {{ok: Boolean, reason: String, filter: Object|null}} ok=false 时调用方必须拒绝，**不能退化成不过滤**
 */
export function resolveMessageScope(filter = {}, userCode, allowedCodes = []) {
    if (!userCode) {
        /** fail-closed：没有身份就没有范围 */
        return {ok: false, reason: 'no-user', filter: null}
    }
    const codes = new Set(allowedCodes || [])
    const req = filter?.conversationCode

    if (tools.isArray(req)) {
        const kept = req.filter(c => codes.has(c))
        return {ok: true, reason: 'intersect', filter: {...filter, conversationCode: kept}}
    }
    if (req === undefined || req === null || req === '') {
        /** 未指定会话：收敛到全部可见会话；一个都没有时是"无结果"而不是"全部" */
        return {ok: true, reason: 'scope-all', filter: {...filter, conversationCode: [...codes]}}
    }
    if (!codes.has(req)) {
        return {ok: false, reason: 'not-member', filter: null}
    }
    return {ok: true, reason: 'member', filter: {...filter, conversationCode: req}}
}

export default {resolveMessageScope}
