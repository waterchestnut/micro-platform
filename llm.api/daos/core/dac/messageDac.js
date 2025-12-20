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
        return params
    }
}

export default new MessageDac(Message)