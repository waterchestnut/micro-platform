/**
 * @fileOverview 智能体任务基础服务
 * @author xianyang 2025/9/8
 * @module
 */

import fs from 'fs'
import {addAgentLog} from '../core/agentLog.js'
import {
    updateAgentTaskWithLock,
    updateParentAgentTaskWithLock,
    updateSubAgentTaskWithLock
} from '../core/agentTask.js'
import agentTaskDac from '../../daos/core/dac/agentTaskDac.js'
import {sendMessage} from '../../daos/kafka/client.js'
import tmplParse from 'json-templates'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const kafkaConfig = config.kafka

/*获取智能体处理器对象*/
async function getAgentHandler(handlerName) {
    let handlerFilePath = llm.baseDir + 'services/agent/handler/' + handlerName + '.js'
    if (!fs.existsSync(handlerFilePath)) {
        logger.error('getAgentHandler，智能体处理器不存在：' + handlerName)
        throw new Error('智能体处理器不存在')
    }
    let Handler = (await import('./handler/' + handlerName + '.js')).default
    /*console.log(Handler)*/
    return new Handler()
}

/*执行完整智能体任务项*/
export async function execAgentTask(agentTaskInfo) {
    if (agentTaskInfo.handleStatus !== 0) {
        addAgentLog(agentTaskInfo, '非等待执行的任务，无需执行', 'none')
        return {
            handleStatus: agentTaskInfo.handleStatus,
            handleRet: agentTaskInfo.handleRet,
            errorMsg: '非等待执行的任务，无需执行'
        }
    }
    let parentAgentTask = null
    if (agentTaskInfo.parentCode) {
        parentAgentTask = await agentTaskDac.getByCode(agentTaskInfo.parentCode)
    }
    let handler = await getAgentHandler(agentTaskInfo.handler)
    let ret = {}
    try {
        let taskInfo = {...agentTaskInfo, parentRet: parentAgentTask?.handleRet}
        if (taskInfo.params) {
            let template = tmplParse(taskInfo.params)
            taskInfo.params = template(taskInfo)
        }
        ret = await handler.exec(taskInfo)
    } catch (e) {
        ret = {
            handleStatus: -1,
            handleRet: agentTaskInfo.handleRet,
            errorMsg: e.message || e,
            subsequentMode: '',
            subsequents: []
        }
        addAgentLog(agentTaskInfo, ret.errorMsg, 'error')
    }
    await updateAgentTaskWithLock(agentTaskInfo.agentCode, {handleStatus: ret.handleStatus, handleRet: ret.handleRet})
    if (parentAgentTask) {
        await updateParentAgentTaskWithLock(agentTaskInfo.parentCode, agentTaskInfo, ret, {})
    }
    if (ret.subsequents?.length) {
        let subAgentTaskList = await agentTaskDac.getTop(ret.subsequents.length, {agentCode: ret.subsequents.map(_ => _.agentCode)})
        if (ret.subsequentMode === 'parallel') {
            await Promise.allSettled(subAgentTaskList.map(_ => execAgentTask(_)))
        } else {
            for (let i = 0; i < ret.subsequents.length; i++) {
                let subAgentTask = subAgentTaskList.find(_ => _.agentCode === ret.subsequents[i].agentCode)
                let subRet = await execAgentTask(subAgentTask)
                if ([-1, 3].includes(subRet.handleStatus) && subAgentTask.errorMode === 'break') {
                    break
                }
                if (subRet.appendAgents?.length > 0) {
                    let needBreak = false
                    for (let j = 0; j < subRet.appendAgents.length; j++) {
                        let appendAgentTask = subRet.appendAgents[j]
                        let appendSubRet = await execAgentTask(appendAgentTask)
                        if ([-1, 3].includes(appendSubRet.handleStatus) && appendAgentTask.errorMode === 'break') {
                            needBreak = true
                            break
                        }
                    }
                    if (needBreak) {
                        break
                    }
                }
            }
        }
    }
    if (agentTaskInfo.nextAgentCode) {
        let nextAgentTask = await agentTaskDac.getByCode(agentTaskInfo.nextAgentCode)
        await sendMessage([{
            topic: kafkaConfig.topics.agentTask.topic,
            key: nextAgentTask.agentCode,
            value: JSON.stringify(nextAgentTask)
        }])
    }

    return ret
}

/*手动触发任务执行*/
export async function manualTriggerAgentTask(agentCode) {
    let agentTaskInfo = await agentTaskDac.getByCode(agentCode)
    return execAgentTask(agentTaskInfo)
}