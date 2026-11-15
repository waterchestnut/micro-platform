/**
 * @fileOverview 操作mongodb库中的message
 * @author xianyang
 * @module
 */

import {Message} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class MessageDac extends BaseDac {
    constructor(Model) {
        super(Model, 'messageCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.messageCode)) {
            params.$and.push({messageCode: {$in: options.messageCode}})
        } else if (options.messageCode) {
            params.$and.push({messageCode: {$eq: options.messageCode}})
        }
        if (tools.isArray(options.conversationCode)) {
            params.$and.push({conversationCode: {$in: options.conversationCode}})
        } else if (options.conversationCode) {
            params.$and.push({conversationCode: {$eq: options.conversationCode}})
        }
        if (tools.isArray(options.channel)) {
            params.$and.push({channel: {$in: options.channel}})
        } else if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        if (tools.isArray(options.channelGroup)) {
            params.$and.push({channelGroup: {$in: options.channelGroup}})
        } else if (options.channelGroup) {
            params.$and.push({channelGroup: {$eq: options.channelGroup}})
        }
        if (tools.isArray(options.llmModel)) {
            params.$and.push({llmModel: {$in: options.llmModel}})
        } else if (options.llmModel) {
            params.$and.push({llmModel: {$eq: options.llmModel}})
        }
        if (tools.isExist(options.query)) {
            params.$and.push({query: {$regex: new RegExpExt(options.query, 'i', true)}})
        }
        if (tools.isExist(options.afterInsertTime)) {
            params.$and.push({insertTime: {$gt: new Date(options.afterInsertTime)}})
        }
        if (tools.isExist(options.beforeInsertTime)) {
            params.$and.push({insertTime: {$lt: new Date(options.beforeInsertTime)}})
        }
        return params
    }
/**
     * @description 取本会话**最近一条**已落库消息的 `extInfo`（只投影 `extInfo.plan`，不拉整个 extInfo）
     * @author xianyang
     * @param {String} conversationCode 会话标识
     * @returns {Promise<Object|null>} 该消息的 extInfo（只含 plan 字段），无历史时 null
     *
     * 服务于 PR-M B1 跨轮 recitation：新一轮开始时，从上一轮档案里把计划捡回来。
     * 三条刻意的约束，都是为了"这点用处不值得多扛一份现网风险"：
     * - 投影只取 `extInfo.plan`：`extInfo` 里有 segments/toolOverflows 这类大块（`getMessages` 默认 `extInfo:0` 就是把它们挡在上下文外），
     *   不能为了读一个计划把整坨拉进内存；
     * - 只取最近一条（`sort:{insertTime:-1}` + limit1 语义）：跨轮只需要"上一轮结束时的计划"，不是事件流；
     * - **调用方必须自己按 `plan_enabled` 门控**：关掉时根本不该发这次查询（见 llmChat 里包在 `if (planOn)` 内）。
     */
    async getLatestExtInfoPlan(conversationCode) {
        if (!conversationCode) {
            return null
        }
        const row = await this.getOneByFilter({conversationCode}, {'extInfo.plan': 1}, {sort: {insertTime: -1}})
        return row?.extInfo || null
    }
}

export default new MessageDac(Message)