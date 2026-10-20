/**
 * @fileOverview 操作mongodb库中的memoryNamespace
 * @module daos/core/dac/memoryNamespaceDac
 */

import {MemoryNamespace} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class MemoryNamespaceDac extends BaseDac {
    constructor(Model) {
        super(Model, 'namespaceCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.namespaceCode) {
            params.$and.push({namespaceCode: {$eq: options.namespaceCode}})
        }
        if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        if ('workspaceId' in options) {
            params.$and.push({workspaceId: options.workspaceId || null})
        }
        if (options.ragCode) {
            params.$and.push({ragCode: {$eq: options.ragCode}})
        }
        if (tools.isExist(options.maxAtomCount)) {
            params.$and.push({atomCount: {$lte: options.maxAtomCount}})
        }
        return params
    }

    /**
     * @description 按命名空间取注册表记录
     * @author xianyang
     * @param {String} userCode 用户标识
     * @param {String} channel 频道标识
     * @param {String} [workspaceId] 沙箱工作区标识
     * @returns {Promise<Object|null>} 注册表记录
     */
    async getByNamespace(userCode, channel, workspaceId = null) {
        const list = await this.getTop(1, {userCode, channel, workspaceId}, {insertTime: 1})
        return list?.[0] || null
    }
}

export default new MemoryNamespaceDac(MemoryNamespace)
