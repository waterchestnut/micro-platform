/**
 * @fileOverview 串行任务调度
 * @author xianyang 2025/9/8
 * @module
 */
import BaseHandler from './base.js'
import {sendMessage} from '../../../daos/kafka/client.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const kafkaConfig = config.kafka

class SequentialDispatch extends BaseHandler {
    constructor() {
        super('sequential')
    }

    async exec(agentTaskInfo) {
        if (agentTaskInfo.handleMode === 'manual') {
            return {
                handleStatus: 1,
                handleRet: agentTaskInfo.handleRet,
                errorMsg: '',
                subsequentMode: 'sequential',
                subsequents: agentTaskInfo.subAgents
            }
        }
        let subAgentTask = agentTaskInfo.subAgents[0]
        await sendMessage([{
            topic: kafkaConfig.topics.agentTask.topic,
            key: subAgentTask.agentCode,
            value: JSON.stringify(subAgentTask)
        }])
        return {
            handleStatus: 1,
            handleRet: agentTaskInfo.handleRet,
            errorMsg: '',
            subsequentMode: '',
            subsequents: []
        }
    }
}

export default SequentialDispatch
