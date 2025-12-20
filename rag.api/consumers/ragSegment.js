/**
 * @fileOverview 知识库材料片段相关的处理
 * @author xianyang 2025/7/22
 * @module
 */

import '../init.js'
import {createClient, subscribe} from '../daos/kafka/client.js'
import {MessagesStreamModes, MessagesStreamFallbackModes} from '@platformatic/kafka'
import {handleSimpleSegment} from '../services/core/ragSegment.js'

const logger = rag.logger
const kafkaConfig = rag.config.kafka

/* node .\consumers\ragSegment.js c1 */
console.log(process.argv)
const client = createClient(`ragSegment-${process.argv.slice(2) || ''}`)
subscribe([kafkaConfig.topics.ragSegment.topic], kafkaConfig.topics.ragSegment.groupId,
    async ({topic, partition, msg}) => {
        try {
            let message = JSON.parse(msg)
            /*console.log(message)*/
            await handleSimpleSegment(message)
        } catch (e) {
            logger.error('ragSegment消息消费出错：' + e)
            logger.error('ragSegment msg：' + msg)
        }

        return 'done'
    },
    client, {mode: MessagesStreamModes.COMMITTED, fallbackMode: MessagesStreamFallbackModes.LATEST})