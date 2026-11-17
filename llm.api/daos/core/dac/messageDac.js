/**
 * @fileOverview 操作mongodb库中的message
 * @author xianyang
 * @module
 */

import {Message} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'
import MessageProgressEnum from '../enum/MessageProgressEnum.js'

/**
 * 终态进度集（PR-G 批二b）。**判"哪些读方只许看完成行"用这一份**，
 * 散在各读点各写一遍字面量，将来加值必有一处漏。
 * 注意不含 waiting：schema 默认值死态，档案里实测零行，列进来只会掩盖形状错误。
 */
export const TERMINAL_PROGRESS = [MessageProgressEnum.finish, MessageProgressEnum.error, MessageProgressEnum.abort]
    .map((e) => e.value)

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
     * - **只取终态行（批二b）**：新一轮自己那行 processing 在本方法被调用时已经存在
     *   （markStarted 在前），不过滤就会把"本轮的空档"当成"上一轮的计划"捡回来——recitation 静默清零。
     */
    async getLatestExtInfoPlan(conversationCode) {
        if (!conversationCode) {
            return null
        }
        const row = await this.getOneByFilter({conversationCode, progress: {$in: TERMINAL_PROGRESS}}, {'extInfo.plan': 1}, {sort: {insertTime: -1}})
        return row?.extInfo || null
    }

    /**
     * @description PR-G 批二b：run 一开始就建一行"进行中"档案（与 llmUsageDac.markStarted 同刻成对）
     * @author menglb
     * @param {Object} info 至少含 messageCode/conversationCode/query/inputs/operator
     * @returns {Promise<Object|null>} 落库后的记录
     * @description
     * 这张表是前端读的面：批二a 已把 progress=processing|waiting 映射成"仍在进行中"，
     * 本方法就是给那个态提供真行。**query/inputs 必须一次写齐**——历史页的提问气泡从
     * `query` 渲染，缺了它刷新只见空气泡不见问题。
     * `$set` 直写而非 BaseDac.upsert：后者 attrOpen=true 会把嵌套对象展开成点路径
     * 并跳过 null 字段，语义与这里要的"整字段覆盖"不符（§25 证伪3 的账）。
     */
    async markStarted(info = {}) {
        if (!info.messageCode) {
            throw new Error('messageCode 不能为空')
        }
        return this._Model.findOneAndUpdate(
            {messageCode: info.messageCode},
            {
                $set: {...info, progress: MessageProgressEnum.processing.value, status: 0, updateTime: new Date()},
                $setOnInsert: {insertTime: new Date()},
            },
            {upsert: true, new: true, setDefaultsOnInsert: true},
        ).lean().exec()
    }

    /**
     * @description 终态整行落库前认领式删除 processing 中途行（批二b 方案 A）
     * @author menglb
     * @param {String} messageCode 本轮标识
     * @returns {Promise<Object|null>} 被删掉的中途行（继承 insertTime 用），没有则 null
     * @description
     * 只匹配 `progress:'processing'`：终态行绝不会被这条删掉（幂等护栏同 persistTurn 的 persisted 旗）。
     * 删走的是 findOneAndDelete——返回的整行让终态写**继承开局时刻**（提问气泡按 insertTime 排序，
     * 不该因补写终态跳到会话尾部）。删除失败不拦终态写：行留在 processing，
     * R1 翻转分支接得住（账本仍是认领门），最坏退化成"多一次翻转"。
     */
    async claimProcessing(messageCode) {
        if (!messageCode) {
            return null
        }
        return this._Model.findOneAndDelete({messageCode, progress: MessageProgressEnum.processing.value}).lean().exec()
    }

    /**
     * @description R1 翻转：把遗弃的 processing 中途行原子改成 abort 档案（批二b）
     * @author menglb
     * @param {String} messageCode 本轮标识
     * @param {Object} fields 要 $set 的终态字段（progress/error/extInfo.*）
     * @returns {Promise<Object|null>} 翻转后的行；行已不在 processing（被终态抢先）返回 null
     * @description
     * 条件是 `{messageCode, progress:'processing'}` 双键——**匹配不到就是没抢到**，
     * 返回 null 让调用方跳过写档，绝不允许退化成 add（那会造出同 messageCode 第二行）。
     */
    async flipProcessingToAbandoned(messageCode, fields = {}) {
        if (!messageCode) {
            return null
        }
        return this._Model.findOneAndUpdate(
            {messageCode, progress: MessageProgressEnum.processing.value},
            {$set: {...fields, updateTime: new Date()}},
            {new: true},
        ).lean().exec()
    }
}

export default new MessageDac(Message)