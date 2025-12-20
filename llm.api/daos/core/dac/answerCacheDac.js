/**
 * @fileOverview 操作mongodb库中的answerCache
 * @author xianyang
 * @module
 */

import {AnswerCache} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class AnswerCacheDac extends BaseDac {
    constructor(Model) {
        super(Model, 'answerCacheCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.answerCacheCode) {
            params.$and.push({answerCacheCode: {$eq: options.answerCacheCode}})
        }
        if (options.sourceConversationCode) {
            params.$and.push({sourceConversationCode: {$eq: options.sourceConversationCode}})
        }
        if (options.sourceMessageCode) {
            params.$and.push({sourceMessageCode: {$eq: options.sourceMessageCode}})
        }
        if (tools.isExist(options.query)) {
            params.$and.push({query: {$regex: new RegExpExt(options.query, 'i', true)}})
        }
        if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        if (options.channelCacheKey) {
            params.$and.push({channelCacheKey: {$eq: options.channelCacheKey}})
        }
        if (options.llmModel) {
            params.$and.push({llmModel: {$eq: options.llmModel}})
        }
        if (options.queryHashCode) {
            params.$and.push({queryHashCode: {$eq: options.queryHashCode}})
        }
        return params
    }
}

export default new AnswerCacheDac(AnswerCache)