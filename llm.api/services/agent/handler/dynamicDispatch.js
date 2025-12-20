/**
 * @fileOverview 动态任务创建与调度
 * @author xianyang 2025/9/29
 * @module
 */
import BaseHandler from './base.js'
import {insertSubAgentTask} from '../../core/agentTask.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const kafkaConfig = config.kafka

class DynamicDispatch extends BaseHandler {
    constructor() {
        super('dynamic')
    }

    async exec(agentTaskInfo) {
        if (!agentTaskInfo.parentCode || !agentTaskInfo.params?.dynamicTaskKey) {
            return {
                handleStatus: -1,
                handleRet: agentTaskInfo.handleRet,
                errorMsg: '无法定位要动态添加的任务，无法动态添加任务',
                subsequentMode: '',
                subsequents: []
            }
        }
        let task = agentTaskInfo
        let keys = agentTaskInfo.params.dynamicTaskKey.split('.')
        for (let i = 0; i < keys.length; i++) {
            if (!task[keys[i]]) {
                task = []
                break
            }
            task = task[keys[i]]
        }
        if (!tools.isArray(task) || !task.length) {
            return {
                handleStatus: -1,
                handleRet: agentTaskInfo.handleRet,
                errorMsg: '要添加的任务不存在，无法动态添加任务',
                subsequentMode: '',
                subsequents: []
            }
        }

        let subTaskList = await insertSubAgentTask(agentTaskInfo.parentCode, task, agentTaskInfo.agentCode)
        if (agentTaskInfo.handleMode === 'queue') {
            agentTaskInfo.nextAgentCode = subTaskList[0].agentCode
        }

        return {
            handleStatus: 2,
            handleRet: subTaskList.map(_ => _.agentCode),
            errorMsg: '',
            subsequentMode: '',
            subsequents: [],
            appendAgents: subTaskList
        }
    }
}

export default DynamicDispatch
