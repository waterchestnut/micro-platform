/**
 * @fileOverview 操作mongodb库中的memoryEvent
 * @module daos/core/dac/memoryEventDac
 */

import {MemoryEvent} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class MemoryEventDac extends BaseDac {
    constructor(Model) {
        super(Model, 'eventCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.eventCode) {
            params.$and.push({eventCode: {$eq: options.eventCode}})
        }
        if (tools.isArray(options.eventCodes)) {
            params.$and.push({eventCode: {$in: options.eventCodes}})
        }
        if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        /** workspaceId 用 in 判定而不是真值判定，null（未启用沙箱）必须能作为有效条件 */
        if ('workspaceId' in options) {
            params.$and.push({workspaceId: options.workspaceId || null})
        }
        if (options.conversationCode) {
            params.$and.push({conversationCode: {$eq: options.conversationCode}})
        }
        if (options.messageCode) {
            params.$and.push({messageCode: {$eq: options.messageCode}})
        }
        if (options.state) {
            params.$and.push({state: {$eq: options.state}})
        }
        if (tools.isArray(options.states)) {
            params.$and.push({state: {$in: options.states}})
        }
        /**
         * 正文关键词检索：召回的归档回退（gatherRawEvents）依赖它。
         * 没有这个分支时基类会静默丢弃该条件，于是"按关键词查"实际返回的是最近几条，
         * 既召不准也看不出错——必须显式实现并转义元字符。
         */
        if (options.content) {
            params.$and.push({content: {$regex: new RegExpExt(options.content, 'i', true)}})
        }
        if (options.role) {
            params.$and.push({role: {$eq: options.role}})
        }
        return params
    }
}

export default new MemoryEventDac(MemoryEvent)
