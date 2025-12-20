/**
 * @fileOverview 操作mongodb库中的conversation
 * @author xianyang
 * @module
 */

import {Conversation} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class ConversationDac extends BaseDac {
    constructor(Model) {
        super(Model, 'conversationCode')
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
        return params
    }
}

export default new ConversationDac(Conversation)