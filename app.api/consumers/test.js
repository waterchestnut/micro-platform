/**
 * @fileOverview 消费者测试
 * @author xianyang
 * @module
 */

import '../init.js'
import {createClient, subscribe} from '../daos/kafka/client.js'

const logger = app.logger
const kafkaConfig = app.config.kafka

/* node .\consumers\test.js c1 */
console.log(process.argv)
const client = createClient(`statistic-${process.argv.slice(2) || ''}`)
subscribe([kafkaConfig.topics.statistic.topic], kafkaConfig.topics.statistic.groupId,
    async ({topic, partition, msg}) => {
        try {
            let message = JSON.parse(msg)
            console.log(message);
        } catch (e) {
            logger.error('statistic消息消费出错：' + e)
            logger.error('statistic msg：' + msg)
        }

        return 'done'
    },
    client, {fromBeginning: true})