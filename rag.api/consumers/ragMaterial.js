/**
 * @fileOverview 知识库材料相关的处理
 * @author xianyang 2025/6/23
 * @module
 */

import '../init.js'
import {createClient, subscribe} from '../daos/kafka/client.js'
import {MessagesStreamModes, MessagesStreamFallbackModes} from '@platformatic/kafka'
import {handleSimpleMaterial} from '../services/core/ragMaterial.js'

const logger = rag.logger
const kafkaConfig = rag.config.kafka

/* node .\consumers\ragMaterial.js c1 */
console.log(process.argv)
const client = createClient(`ragMaterial-${process.argv.slice(2) || ''}`)
subscribe([kafkaConfig.topics.ragMaterial.topic], kafkaConfig.topics.ragMaterial.groupId,
    async ({topic, partition, msg}) => {
        try {
            let message = JSON.parse(msg)
            /*console.log(message)*/
            await handleSimpleMaterial(message)
            //await apabiMaterialService.material2ChunkSimple(message)
        } catch (e) {
            logger.error('ragMaterial消息消费出错：' + e)
            logger.error('ragMaterial msg：' + msg)
        }

        return 'done'
    },
    client, {mode: MessagesStreamModes.COMMITTED, fallbackMode: MessagesStreamFallbackModes.EARLIEST})