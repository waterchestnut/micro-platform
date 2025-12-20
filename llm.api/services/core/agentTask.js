/**
 * @fileOverview 智能体相关的业务操作
 * @author xianyang
 * @module
 */

import agentTaskDac from '../../daos/core/dac/agentTaskDac.js'
import retSchema from '../../daos/retSchema.js'
import redlock from '../../daos/redlock.js'
import {sendMessage} from '../../daos/kafka/client.js'

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
        lock && (await lock.release())
    }
}

/*单例修改智能体任务中的子任务冗余值*/
export async function updateSubAgentTaskWithLock(agentCode, subAgentCode, toUpdateInfo) {
    let lock = null
    try {
        lock = await redlock.acquire(['updateAgentTask:' + agentCode], 5000)
        return agentTaskDac.update({'subAgents.$[idx1]': toUpdateInfo}, {agentCode}, {arrayFilters: [{'idx1.agentCode': subAgentCode}]})
    } finally {
        lock && (await lock.release())
    }
}

/*单例修改父智能体任务的状态、返回结果等值（向上递归修改）*/
export async function updateParentAgentTaskWithLock(parentCode, curAgentTaskInfo, curRet, extToUpdate = {}) {
    let lock = null
    let parentAgentTask = null
    try {
        lock = await redlock.acquire(['updateAgentTask:' + parentCode], 5000)
        await agentTaskDac.update({'subAgents.$[idx1]': {handleStatus: curRet.handleStatus}}, {agentCode: parentCode}, {arrayFilters: [{'idx1.agentCode': curAgentTaskInfo.agentCode}]})
        parentAgentTask = await agentTaskDac.getByCode(parentCode)
        let isDone = true
        let hasError = false
        parentAgentTask.subAgents.forEach((sub) => {
            let handleStatus = sub.agentCode === curAgentTaskInfo.agentCode ? curRet.handleStatus : sub.handleStatus
            if ([-1, 3].includes(handleStatus)) {
                hasError = true
            }
            if ([0, 1].includes(handleStatus)) {
                isDone = false
            }
        })
        let toUpdate = {}
        if (isDone) {
            toUpdate.handleStatus = hasError ? 3 : 2
            parentAgentTask.handleStatus = toUpdate.handleStatus
        } else if ([-1, 3].includes(curRet.handleStatus) && curAgentTaskInfo.errorMode === 'break') {
            toUpdate.handleStatus = 3
            parentAgentTask.handleStatus = toUpdate.handleStatus
        }
        if (curAgentTaskInfo.toParentOutputKey) {
            toUpdate.handleRet = {[curAgentTaskInfo.toParentOutputKey]: curRet.handleRet}
            parentAgentTask.handleRet = {...parentAgentTask.handleRet, ...toUpdate.handleRet}
        }
        /*console.log(curAgentTaskInfo.toParentOutputKey, toUpdate, Object.keys(toUpdate).length)*/
        let toUpdateInfo = {...toUpdate, ...extToUpdate}
        if (Object.keys(toUpdateInfo).length > 0) {
            await agentTaskDac.update(toUpdateInfo, {agentCode: parentCode})
        }
    } finally {
        lock && (await lock.release())
    }

    if (parentAgentTask && parentAgentTask.parentCode) {
        await updateParentAgentTaskWithLock(parentAgentTask.parentCode, parentAgentTask, {
            handleStatus: parentAgentTask.handleStatus,
            handleRet: parentAgentTask.handleRet
        }, {})
    }

    return 1
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
                sub.nextAgentCode = subs[index - 1].agentCode
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
        lock && (await lock.release())
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