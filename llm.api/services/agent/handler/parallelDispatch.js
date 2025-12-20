/**
 * @fileOverview 并行任务调度
 * @author xianyang 2025/9/8
 * @module
 */
import BaseHandler from './base.js'
import {sendMessage} from '../../../daos/kafka/client.js'

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
        for (let i = 0; i < agentTaskInfo.subAgents.length; i++) {
            let subAgentTask = agentTaskInfo.subAgents[i]
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
