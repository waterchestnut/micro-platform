/**
 * @fileOverview kafka的相关客户端操作
 * @author xianyang
 * @module
 */

import {Kafka, Partitioners} from 'kafkajs'

const kafkaConfig = ucenter.config.kafka
const logger = ucenter.logger

const defaultClient = new Kafka({
    clientId: kafkaConfig.clientId,
    brokers: kafkaConfig.brokers,
    retry: kafkaConfig.retry,
    sasl: kafkaConfig.sasl
})

export default defaultClient

const producerList = []

function getProducer(usedClient) {
    let producer = producerList.find(_ => _.usedClient === usedClient)?.producer
    if (!producer) {
        producer = usedClient.producer({createPartitioner: Partitioners.LegacyPartitioner})
        producerList.push({
            usedClient: usedClient,
            producer
        })
    }
    return producer
}

/**
 * 创建kafka客户端实例
 * @author xianyang
 * @param {String} clientPrefix 客户端ID前缀
 * @param {Array} [brokers] kafka服务端连接列表
 * @param {Object} sasl 简单认证
 * @returns {Object} 客户端实例
 */
export const createClient = (clientPrefix, brokers = kafkaConfig.brokers, sasl = kafkaConfig.sasl) => {
    let prefix = process.env.CLIENT_PREFIX || clientPrefix
    let clientId = prefix + '-' + kafkaConfig.clientId + (process.env.CLIENT_ID ? ('-' + process.env.CLIENT_ID) : '')
    return new Kafka({
        clientId: clientId,
        brokers: brokers,
        retry: kafkaConfig.retry,
        sasl
    })
}

/**
 * 生产者角色发送数据
 * @author xianyang
 * @param {String} topic 主题
 * @param {String} groupId 分组
 * @param {Array} msgs 消息列表
 * @param {String} [msgs.key] key
 * @param {String} msgs.value value
 * @param {Number} [msgs.partition] partition
 * @param {Object} [msgs.headers] headers
 * @param {Object} [client] 客户端实例
 * @returns {*} 发送是否成功
 */
export const sendMessage = async (topic, groupId, msgs, client = defaultClient) => {
    try {
        const producer = getProducer(client)
        await producer.connect()
        await producer.send({
            topic: topic,
            messages: msgs,
            acks: 1
        })
        return true
    } catch (error) {
        throw error
    }

}

/**
 * 消费者订阅消息
 * @author xianyang
 * @param {Array} topics 订阅的消息主题列表
 * @param {String} groupId 分组
 * @param {Function} callback 回调函数，传参：{topic, partition, msg}
 * @param {Object} [client] 客户端实例
 * @returns {*} 订阅是否成功
 */
export const subscribe = async (topics, groupId, callback, client = defaultClient, options = {}) => {
    try {
        const consumer = client.consumer({
            groupId: groupId
        })
        await consumer.connect()
        for (let i = 0; i < topics.length; i++) {
            await consumer.subscribe({
                topic: topics[i],
                ...options
            })
        }
        await consumer.run({
            autoCommit: true,
            eachMessage: async ({
                                    topic,
                                    partition,
                                    message
                                }) => {
                //防止重复消费数据
                await consumer.commitOffsets([{
                    topic: topic,
                    partition: partition,
                    offset: Number(message.offset) + 1
                }])
                /*console.log(message.value)*/
                let msg = message.value.toString()
                await callback({topic, partition, msg})
            }
        })
        registerErrorHandler(consumer)
        return consumer
    } catch (err) {
        throw err
    }
}

/**
 * 进程出错时消费者错误处理
 * @param {Object} consumer 消费者对象
 * @returns {*}
 */
function registerErrorHandler(consumer) {
    const errorTypes = ['unhandledRejection', 'uncaughtException']
    const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2']
    errorTypes.map(type => {
        process.on(type, async e => {
            try {
                logger.error(`process.on ${type}`)
                logger.error(e)
                await consumer.disconnect()
                process.exit(0)
            } catch (_) {
                process.exit(1)
            }
        })
    })

    signalTraps.map(type => {
        process.once(type, async () => {
            try {
                await consumer.disconnect()
            } finally {
                process.kill(process.pid, type)
            }
        })
    })
}