/**
 * @fileOverview 串行任务调度
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
        // subAgents 入库时为简化引用，需取回完整任务再派发（与 execAgentTask 的 nextAgentCode 派发同语义）
        const subAgentTask = await agentTaskDac.getByCode(agentTaskInfo.subAgents[0].agentCode)
        if (!subAgentTask) {
            throw new Error('子任务不存在：' + agentTaskInfo.subAgents[0].agentCode)
        }
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
