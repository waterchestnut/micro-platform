/**
 * @fileOverview 日志解析相关的处理
 * @author xianyang
 * @module
 */

import '../init.js'
import {createClient, subscribe} from '../daos/kafka/client.js'
import {MessagesStreamModes, MessagesStreamFallbackModes} from '@platformatic/kafka'
import {parseLogMsgInfo} from '../services/core/msgInfo.js'

const logger = statistic.logger
const kafkaConfig = statistic.config.kafka

/* node .\consumers\parseLog.js c1 */
console.log(process.argv)
const client = createClient(`parseLog-${process.argv.slice(2) || ''}`)
subscribe([kafkaConfig.topics.statistic.topic], kafkaConfig.topics.statistic.groupId,
    async ({topic, partition, msg}) => {
        try {
            let message = JSON.parse(msg)
            /*console.log(message)*/
            await parseLogMsgInfo(message)
        } catch (e) {
            logger.error('parseLog消息消费出错：' + e)
            logger.error('parseLog msg：' + msg)
        }

        return 'done'
    },
    client, {mode: MessagesStreamModes.COMMITTED, fallbackMode: MessagesStreamFallbackModes.EARLIEST})