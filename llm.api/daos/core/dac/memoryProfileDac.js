/**
 * @fileOverview 操作mongodb库中的memoryProfile
 * @module daos/core/dac/memoryProfileDac
 */

import {MemoryProfile} from '../schema/index.js'
import BaseDac from './BaseDac.js'

export class MemoryProfileDac extends BaseDac {
    constructor(Model) {
        super(Model, null)
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        if ('workspaceId' in options) {
            params.$and.push({workspaceId: options.workspaceId || null})
        }
        return params
    }

    /**
     * @description 按命名空间读取owner文档
     * @author xianyang
     * @param {String} userCode 用户标识
     * @param {String} channel 频道标识
     * @param {String} [workspaceId] 沙箱工作区标识
     * @returns {Promise<Object|null>} profile记录
     */
    async getByNamespace(userCode, channel, workspaceId = null) {
        const list = await this.getTop(1, {userCode, channel, workspaceId}, {updateTime: -1})
        return list?.[0] || null
    }

    /**
     * @description 按命名空间取owner文档，不存在时按空文档创建
     * @author xianyang
     * @param {String} userCode 用户标识
     * @param {String} channel 频道标识
     * @param {String} [workspaceId] 沙箱工作区标识
     * @param {Object} [newInfo] 创建时的附加信息
     * @returns {Promise<Object>} profile记录
     */
    async getOrCreate(userCode, channel, workspaceId = null, newInfo = {}) {
        return this.upsert({
            ...newInfo,
            userCode,
            channel,
            workspaceId,
        }, {userCode, channel, workspaceId})
    }
}

export default new MemoryProfileDac(MemoryProfile)
