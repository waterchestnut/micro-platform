/**
 * @fileOverview 操作mongodb库中的conversation
 * @author xianyang
 * @module
 */

import {Conversation} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class ConversationDac extends BaseDac {
    constructor(Model) {
        super(Model, 'conversationCode')
    }

    /**
     * @description 按会话标识获取或创建u2u会话（$setOnInsert原子插入，防并发重复创建）
     * @param {String} conversationCode 会话标识（由genConversationCode生成，与用户对一一对应）
     * @param {Object} newInfo 会话信息
     * @returns {Promise<Object>} 会话记录对象
     */
    async getOrCreateByConversationCode(conversationCode, newInfo) {
        return this._Model.findOneAndUpdate(
            {conversationCode},
            {$setOnInsert: newInfo},
            {upsert: true, new: true, setDefaultsOnInsert: true}
        ).lean().exec()
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
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
        if (tools.isExist(options.title)) {
            params.$and.push({title: {$regex: new RegExpExt(options.title, 'i', true)}})
        }
        if (tools.isExist(options.userCode)) {
            params.$and.push({
                $or: [
                    {userCodes: options.userCode},
                    {'operator.userCode': options.userCode},
                ]
            })
        }
        if (tools.isExist(options.conversationType)) {
            params.$and.push({conversationType: {$eq: options.conversationType}})
        }
        if (tools.isExist(options.keywords)) {
            let keywordReg = {$regex: new RegExpExt(options.keywords, 'i', true)}
            params.$and.push({
                $or: [
                    {title: keywordReg},
                    {'tags.value': keywordReg},
                ]
            })
        }
        return params
    }
}

export default new ConversationDac(Conversation)