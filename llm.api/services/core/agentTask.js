/**
 * @fileOverview 智能体相关的业务操作
 * @author xianyang
 * @module
 */

import agentTaskDac from '../../daos/core/dac/agentTaskDac.js'
import retSchema from '../../daos/retSchema.js'
import redlock from '../../daos/redlock.js'
import {sendMessage} from '../../daos/kafka/client.js'
import {reduceParentStatus, shouldDispatchNext, shouldTriggerFinalize} from './session/parentAggregate.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const kafkaConfig = config.kafka

/**
 * @description 获取智能体任务
 * @author xianyang
 * @param {String} agentCode 智能体标识
 * @returns {Promise<Object>} 智能体元数据详细信息
 */
export async function getAgentTask(agentCode) {
    return agentTaskDac.getByCode(agentCode)
}

/*单例修改智能体任务*/
export async function updateAgentTaskWithLock(agentCode, toUpdateInfo) {
    let lock = null
    try {
        lock = await redlock.acquire(['updateAgentTask:' + agentCode], 5000)
        return agentTaskDac.update(toUpdateInfo, {agentCode})
    } finally {
        await safeUnlock(lock)
    }
}

/*单例修改智能体任务中的子任务冗余值*/
export async function updateSubAgentTaskWithLock(agentCode, subAgentCode, toUpdateInfo) {
    let lock = null
    try {
        lock = await redlock.acquire(['updateAgentTask:' + agentCode], 5000)
        return agentTaskDac.update({'subAgents.$[idx1]': toUpdateInfo}, {agentCode}, {arrayFilters: [{'idx1.agentCode': subAgentCode}]})
    } finally {
        await safeUnlock(lock)
    }
}

/*单例修改父智能体任务的状态、返回结果等值（向上递归修改）*/
export async function updateParentAgentTaskWithLock(parentCode, curAgentTaskInfo, curRet, extToUpdate = {}) {
    let lock = null
    let parentAgentTask = null
    let dispatchNextCode = null
    let finalizeRoot = null
    try {
        lock = await redlock.acquire(['updateAgentTask:' + parentCode], 5000)
        await agentTaskDac.update({'subAgents.$[idx1]': {handleStatus: curRet.handleStatus}}, {agentCode: parentCode}, {arrayFilters: [{'idx1.agentCode': curAgentTaskInfo.agentCode}]})
        parentAgentTask = await agentTaskDac.getByCode(parentCode)
        const prevStatus = parentAgentTask.handleStatus
        /**
         * 锁内聚合判据转写为纯件 `parentAggregate.reduceParentStatus/shouldDispatchNext`（B0，行为等价）。
         * 此前这段现网 fan-out 汇聚热路径**零可执行用例**（recoverCandidate 同款病）；基线表见
         * `test/services/core/session/parentAggregate.test.js`——B0/B1 改造前后都必须全绿。
         */
        const { toUpdate, newStatus } = reduceParentStatus({
            subAgents: parentAgentTask.subAgents,
            curAgentTaskInfo,
            curRet,
        })
        if (newStatus !== null) {
            parentAgentTask.handleStatus = newStatus
        }
        if (curAgentTaskInfo.toParentOutputKey) {
            parentAgentTask.handleRet = {...parentAgentTask.handleRet, ...toUpdate.handleRet}
        }
        /*console.log(curAgentTaskInfo.toParentOutputKey, toUpdate, Object.keys(toUpdate).length)*/
        let toUpdateInfo = {...toUpdate, ...extToUpdate}
        if (Object.keys(toUpdateInfo).length > 0) {
            await agentTaskDac.update(toUpdateInfo, {agentCode: parentCode})
        }
        // 父任务首次成功完成且自身在 queue 串行链上有后继（典型：sequential 嵌套 parallel 时，
        // parallel 父级完成后无人派发其 nextAgentCode）——与 execAgentTask 尾部派发同语义
        if (shouldDispatchNext({
            newStatus, prevStatus, handleMode: parentAgentTask.handleMode, nextAgentCode: parentAgentTask.nextAgentCode,
        })) {
            dispatchNextCode = parentAgentTask.nextAgentCode
        }
        /**
         * finalize 触发标志（C/B1）：**锁内只设标志**——判据每侧都钉死防误伤/防循环
         * （总开关默认关 / 显式 orchestrated root / 首次到终态 / 已有 orchestration 结果不再触发 / 自递归跳过）。
         * 真正的派发在 finally 释放锁**之后**——持锁调模型会拖炸建课等所有现网 fan-out（§9 接入发现的原话）。
         */
        const fanOutCfg = config.agentTask?.fanOutOrchestration || {}
        if (shouldTriggerFinalize({
            newStatus,
            prevStatus,
            agentRole: parentAgentTask.agentRole,
            orchestrated: parentAgentTask.orchestrated === true,
            enabled: fanOutCfg.enabled === true,
            alreadyFinalized: !!(parentAgentTask.handleRet && parentAgentTask.handleRet.orchestration),
            isSelfRecursion: curAgentTaskInfo?.agentCode === parentCode,
        })) {
            finalizeRoot = parentAgentTask
        }
    } finally {
        await safeUnlock(lock)
    }

    if (finalizeRoot) {
        await dispatchFanOutFinalize(finalizeRoot, config.agentTask?.fanOutOrchestration || {})
    }

    if (dispatchNextCode) {
        let nextAgentTask = await agentTaskDac.getByCode(dispatchNextCode)
        if (nextAgentTask?.handleStatus === 0) {
            await sendMessage([{
                topic: kafkaConfig.topics.agentTask.topic,
                key: nextAgentTask.agentCode,
                value: JSON.stringify(nextAgentTask)
            }])
        }
    }

    if (parentAgentTask && parentAgentTask.parentCode) {
        await updateParentAgentTaskWithLock(parentAgentTask.parentCode, parentAgentTask, {
            handleStatus: parentAgentTask.handleStatus,
            handleRet: parentAgentTask.handleRet
        }, {})
    }

    return 1
}

/**
 * @description 锁外派发编排 finalize task（C/B1）。两种 dispatch 模式的取舍写在配置注释里（kafka=持久可重试，
 *   direct=本进程 fire-and-forget，e2e/单实例用）。两种都**绝不**投回"root 自己"去走 execAgentTask——
 *   finalize 是独立内存 task（agentCode=`fin-<root>`，不入库不占队列语义），只经 handler 写回 root。
 * @param {Object} rootTask 锁内捕获的编排 root 快照
 * @param {Object} cfg `agentTask.fanOutOrchestration`
 * @returns {Promise<void>}
 */
async function dispatchFanOutFinalize(rootTask, cfg) {
    const finTask = {
        agentCode: 'fin-' + rootTask.agentCode,
        agentType: 'local',
        handler: 'fanOutFinalizeTask',
        handleMode: 'manual',      // 即便将来想落库也不自动派发；当前根本不入库（内存对象）
        handleStatus: 0,
        agentRole: 'finalize',
        conversationCode: rootTask.conversationCode,
        operator: rootTask.operator,
        params: {
            rootCode: rootTask.agentCode,
            originalQuery: rootTask.params?.query || rootTask.title || '',
            channel: rootTask.params?.channel,
            protocol: rootTask.params?.protocol,
            ...(rootTask.params?.synthesisExecOptions ? {execOptionsExtra: rootTask.params.synthesisExecOptions} : {}),
        },
    }
    if (cfg.dispatch === 'direct') {
        /** 动态 import：`services/agent/index.js` 静态引了本模块（core→agent→core 成环；且它顶层读 llm 会炸启动），
         *  与 root.js 对重模块的处置同规——用到才拿，函数作用域里 llm 全局早已就绪 */
        const { execAgentTask } = await import('../agent/index.js')
        execAgentTask(finTask)
            .then((ret) => logger.info(`fan-out finalize 完成: root=${finTask.params.rootCode} status=${ret?.handleStatus}`))
            .catch((e) => logger.error(`fan-out finalize 失败(direct): root=${finTask.params.rootCode} ${String(e?.stack || e?.message || e).slice(0, 400)}`))
        return
    }
    try {
        await sendMessage([{
            topic: kafkaConfig.topics.agentTask.topic,
            key: finTask.agentCode,
            value: JSON.stringify(finTask),
        }])
    } catch (e) {
        logger.error(`fan-out finalize 投递失败(kafka): root=${finTask.params.rootCode} ${String(e?.message || e).slice(0, 300)}`)
    }
}

/*添加智能体执行任务*/
export async function addAgentTask(agentTaskInfo) {
    let list = []
    formatWaitAddAgentTask(agentTaskInfo, list, null)
    await agentTaskDac.bulkUpdate(list)
    if (agentTaskInfo.handleMode === 'queue') {
        await sendMessage([{
            topic: kafkaConfig.topics.agentTask.topic,
            key: agentTaskInfo.agentCode,
            value: JSON.stringify(agentTaskInfo)
        }])
    }
    return list.length
}

/*格式化待插入的智能体任务信息*/
function formatWaitAddAgentTask(agentTaskInfo, taskList, parentInfo) {
    agentTaskInfo.agentCode = agentTaskInfo.agentCode || tools.getUUID()
    agentTaskInfo.parentCode = parentInfo?.agentCode
    agentTaskInfo.agentCodePath = [...(parentInfo?.agentCodePath || []), agentTaskInfo.agentCode]
    agentTaskInfo.operator = agentTaskInfo.operator || parentInfo?.operator
    agentTaskInfo.handleStatus = agentTaskInfo.handleStatus || 0
    taskList.push(agentTaskInfo)
    if (!agentTaskInfo.subAgents?.length) {
        return agentTaskInfo
    }
    let simpleSubs = []
    let subs = agentTaskInfo.subAgents.map(_ => {
        let sub = formatWaitAddAgentTask(_, taskList, agentTaskInfo)
        simpleSubs.push({
            agentCode: sub.agentCode,
            handleStatus: sub.handleStatus,
        })
        return sub
    })
    if (agentTaskInfo.agentType === 'sequential' && agentTaskInfo.handleMode === 'queue') {
        subs.forEach((sub, index) => {
            if (index < subs.length - 1) {
                sub.nextAgentCode = subs[index + 1].agentCode
            }
        })
    }
    agentTaskInfo.subAgents = simpleSubs
    return agentTaskInfo
}

/*插入子智能体任务*/
export async function insertSubAgentTask(parentAgentCode, subTaskList, afterAgentCode) {
    let lock = null
    let parentAgentInfo = null
    let list = []
    try {
        lock = await redlock.acquire(['updateAgentTask:' + parentAgentCode], 5000)
        parentAgentInfo = await agentTaskDac.getByCode(parentAgentCode)
        subTaskList.forEach(_ => {
            formatWaitAddAgentTask(_, list, parentAgentInfo)
        })
        parentAgentInfo.subAgents = parentAgentInfo.subAgents || []
        let startIndex = afterAgentCode ? (parentAgentInfo.subAgents.findIndex(_ => _.agentCode === afterAgentCode) + 1) : parentAgentInfo.subAgents.length
        subTaskList.forEach((sub, index) => {
            parentAgentInfo.subAgents.splice(startIndex + index, 0, {
                agentCode: sub.agentCode,
                handleStatus: sub.handleStatus,
            })
        })
        //console.log(parentAgentInfo.subAgents)
        await agentTaskDac.bulkUpdate(list)
        await agentTaskDac.update({subAgents: parentAgentInfo.subAgents}, {agentCode: parentAgentCode})
    } finally {
        await safeUnlock(lock)
    }

    if (parentAgentInfo?.agentType === 'sequential' && parentAgentInfo?.handleMode === 'queue') {
        subTaskList.forEach((sub, index) => {
            let next = parentAgentInfo.subAgents[parentAgentInfo.subAgents.findIndex(_ => _.agentCode === sub.agentCode) + 1]
            if (next) {
                sub.nextAgentCode = next.agentCode
            }
        })
        if (afterAgentCode) {
            await updateAgentTaskWithLock(afterAgentCode, {nextAgentCode: subTaskList[0].agentCode})
        }
    }

    return list
}

export async function getAgentTaskAllDetail(agentCode) {
    let options = {
        complexFilter: [
            {agentCodePath: {$eq: agentCode}}
        ]
    }
    let taskList = await agentTaskDac.getTop(10000, options, {insertTime: 1})
    // logger.debug(JSON.stringify(taskList));
    return taskList
}

/**
 * @description 批量获取任务列表
 * @param {Object} filter
 * @param {String[]} [filter.agentCodes] 筛选agentCode
 * @param {String[]} [filter.inPathCodes] 筛选agentCodePath
 * @return {Promise<Array|*[]>}
 */
export async function getAgentTaskListByFilter(filter = {}) {
    let options = {
        complexFilter: []
    }
    if (filter.agentCodes?.length) {
        options.agentCode = filter.agentCodes
    }
    if (filter.inPathCodes?.length) {
        options.complexFilter.push({agentCodePath: {$in: filter.inPathCodes}})
    }
    if (Object.keys(options).length < 2 && !options.complexFilter.length) {
        return []
    }
    let total = await agentTaskDac.getCount(options)
    if (!total) {
        return []
    }
    return agentTaskDac.getTop(total, options, {insertTime: 1})
}

async function safeUnlock(lock) {
    if (!lock) return

    // 1. 如果锁已经过了客户端记录的生命周期，直接跳过，防止触发 redlock 的重试卡死
    if (lock.expiration < Date.now()) {
        console.warn('锁已过期，无需释放')
        return
    }

    try {
        await lock.release()
    } catch (err) {
        // 捕获可能由于已经释放过导致的报错
        console.error('解锁失败或锁已被释放:', err.message)
    }
}