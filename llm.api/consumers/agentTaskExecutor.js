/**
 * @fileOverview 智能体任务异步执行处理
 * @author xianyang
 * @module
 */

import '../init.js'
import {createClient, subscribe} from '../daos/kafka/client.js'
import {MessagesStreamModes, MessagesStreamFallbackModes} from '@platformatic/kafka'
import {execAgentTask} from '../services/agent/index.js'

const logger = llm.logger
const kafkaConfig = llm.config.kafka

/* node .\consumers\agentTaskExecutor.js c1 */
console.log(process.argv)
const client = createClient(`agentTaskExecutor-${process.argv.slice(2) || ''}`)
subscribe([kafkaConfig.topics.agentTask.topic], kafkaConfig.topics.agentTask.groupId,
    async ({topic, partition, msg}) => {
        try {
            let message = JSON.parse(msg)
            /*console.log(message)*/
            await execAgentTask(message)
        } catch (e) {
            logger.error('agentTaskExecutor消息消费出错：' + e)
            logger.error('agentTaskExecutor msg：' + msg)
        }

        return 'done'
    },
    client, {mode: MessagesStreamModes.COMMITTED, fallbackMode: MessagesStreamFallbackModes.EARLIEST})