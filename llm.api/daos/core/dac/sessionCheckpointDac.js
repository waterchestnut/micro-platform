/**
 * @fileOverview 操作mongodb中的sessionCheckpoint
 * @module daos/core/dac/sessionCheckpointDac
 */

import {SessionCheckpoint} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class SessionCheckpointDac extends BaseDac {
    constructor(Model) {
        super(Model, 'checkpointCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.checkpointCode) {
            params.$and.push({checkpointCode: {$eq: options.checkpointCode}})
        }
        if (tools.isArray(options.checkpointCodes)) {
            params.$and.push({checkpointCode: {$in: options.checkpointCodes}})
        }
        if (options.conversationCode) {
            params.$and.push({conversationCode: {$eq: options.conversationCode}})
        }
        if (options.messageCode) {
            params.$and.push({messageCode: {$eq: options.messageCode}})
        }
        if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        if (options.phase) {
            params.$and.push({phase: {$eq: options.phase}})
        }
        if (tools.isArray(options.phases)) {
            params.$and.push({phase: {$in: options.phases}})
        }
        if (tools.isExist(options.maxSeq)) {
            params.$and.push({seq: {$lte: options.maxSeq}})
        }
        /** 压实任务按写入时间划界，缺这个条件会误删近期检查点，必须显式传 Date */
        if (options.beforeInsertTime instanceof Date) {
            params.$and.push({insertTime: {$lt: options.beforeInsertTime}})
        }
        return params
    }

    /**
     * @description 取会话内当前最大序号，用于分配 seq
     * @author xianyang
     * @param {String} conversationCode 会话标识
     * @returns {Promise<Number>} 最大 seq，无记录时为 0
     */
    async getMaxSeq(conversationCode) {
        if (!conversationCode) {
            return 0
        }
        const rows = await this.getTop(1, {conversationCode}, {seq: -1})
        return rows?.[0]?.seq || 0
    }

    /**
     * @description 按会话倒序取检查点
     * @author xianyang
     * @param {String} conversationCode 会话标识
     * @param {Number} [limit] 条数
     * @returns {Promise<Object[]>} 检查点列表（seq 倒序）
     */
    async listByConversation(conversationCode, limit = 50) {
        return await this.getTop(limit, {conversationCode}, {seq: -1})
    }
}

export default new SessionCheckpointDac(SessionCheckpoint)
