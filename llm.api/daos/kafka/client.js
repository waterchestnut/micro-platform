/**
 * @fileOverview kafka的相关客户端操作
 * @author xianyang
 * @module
 */

import {Producer, stringSerializers, Consumer, stringDeserializers, Admin} from '@platformatic/kafka'

const kafkaConfig = llm.config.kafka
const logger = llm.logger

const defaultClient = {
    clientId: kafkaConfig.clientId,
    bootstrapBrokers: kafkaConfig.brokers,
    ...kafkaConfig.retry,
    sasl: kafkaConfig.sasl,
    autocreateTopics: kafkaConfig.autocreateTopics
}

export default defaultClient

const producerList = []

function getProducer(usedClient) {
    let producer = producerList.find(_ => _.usedClient === usedClient)?.producer
    if (!producer) {
        producer = new Producer({
            ...usedClient,
            serializers: stringSerializers,
        })
        producerList.push({
            usedClient: usedClient,
            producer
        })
    }
    return producer
}

/**
 * 生成kafka客户端配置
 * @author xianyang
 * @param {String} clientPrefix 客户端ID前缀
 * @param {Array} [brokers] kafka服务端连接列表
 * @param {Object} sasl 简单认证
 * @returns {Object} 客户端配置
 */
export const createClient = (clientPrefix, brokers = kafkaConfig.brokers, sasl = kafkaConfig.sasl) => {
    let prefix = process.env.CLIENT_PREFIX || clientPrefix
    let clientId = prefix + '-' + kafkaConfig.clientId + (process.env.CLIENT_ID ? ('-' + process.env.CLIENT_ID) : '')
    return {
        clientId,
        bootstrapBrokers: kafkaConfig.brokers,
        ...kafkaConfig.retry,
        sasl: kafkaConfig.sasl,
        autocreateTopics: kafkaConfig.autocreateTopics
    }
}

/**
 * 生产者角色发送数据
 * @author xianyang
 * @param {Array} msgs 消息列表
 * @param {String} [msgs.key] key
 * @param {String} msgs.value value
 * @param {String} [msgs.topic] partition
 * @param {Number} [msgs.partition] partition
 * @param {Object} [msgs.headers] headers
 * @param {Object} [msgs.timestamp] timestamp
 * @param {Object} [client] 客户端配置
 * @returns {*} 发送是否成功
 */
export const sendMessage = async (msgs, client = defaultClient) => {
    try {
        const producer = getProducer(client)
        await producer.send({
            messages: msgs,
            acks: 1
        })
        return true
    } catch (error) {
        if (error.code === 'PLT_KFK_CONNECTION_ERROR') {
            // Handle connection errors
            producerList.splice(producerList.findIndex(_ => _.usedClient === client), 1)
        }

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
 * @param {Object} [options] 其他consume参数
 * @returns {*} 订阅是否成功
 */
export const subscribe = async (topics, groupId, callback, client = defaultClient, options = {}) => {
    try {
        const consumer = new Consumer({
            ...client,
            groupId,
            deserializers: stringDeserializers
        })
        const stream = await consumer.consume({
            autocommit: false,
            topics,
            sessionTimeout: 10000,
            heartbeatInterval: 2000,
            ...options
        })
        for await (const message of stream) {
            //console.log(message)
            if(message.commit){
                await message.commit()
            }
            await callback({topic: message.topic, partition: message.partition, msg: message.value})
        }
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
                await consumer.close()
                process.exit(0)
            } catch (_) {
                process.exit(1)
            }
        })
    })

    signalTraps.map(type => {
        process.once(type, async () => {
            try {
                await consumer.close()
            } finally {
                process.kill(process.pid, type)
            }
        })
    })
}

export async function listAllGroups() {
    const admin = new Admin({
        ...defaultClient
    })
    console.log(await admin.listGroups())
}