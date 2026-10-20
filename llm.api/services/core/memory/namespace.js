/**
 * @fileOverview 记忆命名空间与灰度开关
 * @module services/core/memory/namespace
 * @description 隔离边界 = userCode + channel（workspaceId 预留）。
 * channelGroup 是软亲和（加权）而非硬隔离：文献助手按 resCode 分桶，
 * 硬过滤会让同一个人跨论文的偏好被切碎。
 */

import memoryNamespaceDac from '../../../daos/core/dac/memoryNamespaceDac.js'
import {getMemoryStore} from './store/index.js'
import {isSafeUserCode} from './policy.js'

const logger = llm.logger

export {isMemoryEnabled, isSafeUserCode} from './policy.js'

/**
 * @description 取或初始化命名空间
 *
 * 命名空间表归 llm.api 所有，可插拔的 store 只负责分配外部资源（如 ragCode），
 * 否则词法后端不返回坐标会让上层拿到空 userCode 而静默丢事件。
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.userCode 用户标识
 * @param {String} params.channel 频道标识
 * @param {String} [params.workspaceId] 沙箱工作区标识
 * @param {Object} [params.operator] 操作人
 * @returns {Promise<Object|null>} 命名空间记录，失败返回 null（调用方需降级）
 */
export async function resolveNamespace({userCode, channel, workspaceId = null, operator = null}) {
    if (!userCode || !channel) {
        return null
    }
    /** 主键不能是共享账号：记忆一旦跨人共用即是数据泄露，宁可不记 */
    if (!isSafeUserCode(userCode)) {
        logger.warn(`userCode(${userCode}) 形态不适合做记忆主键，跳过本次记忆操作`)
        return null
    }
    const exist = await memoryNamespaceDac.getByNamespace(userCode, channel, workspaceId)
    if (exist) {
        return exist
    }

    let ragCode = null
    try {
        const store = await getMemoryStore()
        const allocated = await store.ensureNamespace({userCode, channel, workspaceId, operator})
        ragCode = allocated?.ragCode || null
    } catch (e) {
        /** 外部索引资源分配失败不阻断记忆：Mongo 侧仍是权威存储，召回降级为词法 */
        logger.error(`分配记忆外部检索资源失败(${channel}/${userCode})，退回词法模式: ${e.message}`)
    }

    try {
        return await memoryNamespaceDac.add({
            userCode, channel, workspaceId: workspaceId || null, ragCode,
            atomCount: 0, lastActiveAt: new Date(),
            operator: {userCode: operator?.userCode || userCode, realName: operator?.realName || ''},
        })
    } catch (e) {
        /** 并发首写会撞唯一键，回读即可 */
        const again = await memoryNamespaceDac.getByNamespace(userCode, channel, workspaceId)
        if (again) {
            return again
        }
        logger.error(`初始化记忆命名空间失败(${channel}/${userCode}): ${e.message}`)
        return null
    }
}

