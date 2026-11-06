/**
 * @fileOverview 并行任务调度
 * @author xianyang 2025/9/8
 * @module
 */
import BaseHandler from './base.js'
import {sendMessage} from '../../../daos/kafka/client.js'
import agentTaskDac from '../../../daos/core/dac/agentTaskDac.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const kafkaConfig = config.kafka

class ParallelDispatch extends BaseHandler {
    constructor() {
        super('parallel')
    }

    async exec(agentTaskInfo) {
        if (agentTaskInfo.handleMode === 'manual') {
            return {
                handleStatus: 1,
                handleRet: agentTaskInfo.handleRet,
                errorMsg: '',
                subsequentMode: 'parallel',
                subsequents: agentTaskInfo.subAgents
            }
        }
        // 与 sequentialDispatch 同语义：简化引用需回查完整子任务后再派发
        for (let i = 0; i < agentTaskInfo.subAgents.length; i++) {
            let subAgentTask = await agentTaskDac.getByCode(agentTaskInfo.subAgents[i].agentCode)
            if (!subAgentTask) {
                logger.error('parallelDispatch 子任务不存在：' + agentTaskInfo.subAgents[i].agentCode)
                continue
            }
            await sendMessage([{
                topic: kafkaConfig.topics.agentTask.topic,
                key: subAgentTask.agentCode,
                value: JSON.stringify(subAgentTask)
            }])
        }
        return {
            handleStatus: 1,
            handleRet: agentTaskInfo.handleRet,
            errorMsg: '',
            subsequentMode: '',
            subsequents: []
        }
    }
}

export default ParallelDispatch
