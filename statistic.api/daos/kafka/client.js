/**
 * @fileOverview kafka的相关客户端操作
 * @author xianyang
 * @module
 */

import {Producer, stringSerializers, Consumer, stringDeserializers, Admin} from '@platformatic/kafka'

const kafkaConfig = statistic.config.kafka
const logger = statistic.logger

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
        producerList.push({usedClient, producer})
    }
    return producer
}

/**
 * 生成kafka客户端配置
 * @author xianyang
 * @param {String} clientPrefix 客户端ID前缀
 * @param {Array} [brokers] kafka服务端连接列表
 * @param {Object} [sasl] 简单认证
 * @returns {Object} 客户端配置
 */
export const createClient = (clientPrefix, brokers = kafkaConfig.brokers, sasl = kafkaConfig.sasl) => {
    let prefix = process.env.CLIENT_PREFIX || clientPrefix
    let clientId = prefix + '-' + kafkaConfig.clientId + (process.env.CLIENT_ID ? ('-' + process.env.CLIENT_ID) : '')
    return {
        clientId,
        bootstrapBrokers: brokers,
        ...kafkaConfig.retry,
        sasl,
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
 * @returns {Boolean} 发送是否成功
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
            let idx = producerList.findIndex(_ => _.usedClient === client)
            if (idx > -1) producerList.splice(idx, 1)
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
 * @returns {Promise<Object>} 消费者实例
 */
export const subscribe = async (topics, groupId, callback, client = defaultClient, options = {}) => {
    const consumer = new Consumer({
        ...client,
        groupId,
        deserializers: stringDeserializers
    })

    registerErrorHandler(consumer)

    let activeStream = null
    let recreateTimer = null
    const withTimeout = (promise, ms) => {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Kafka commit timeout')), ms))
        ])
    }

    async function createStream() {
        if (activeStream && !activeStream.destroyed) {
            activeStream.destroy()
        }

        let stream = await consumer.consume({
            autocommit: false,
            topics,
            sessionTimeout: 30000,
            heartbeatInterval: 3000,
            maxBytes: 256 * 1024,
            ...options
        })

        stream.on('data', async (message) => {
            try {
                logger.info(`Message received [Topic: ${message.topic}, Partition: ${message.partition}, Offset: ${message.offset}]`)
                stream.pause()

                await callback({topic: message.topic, partition: message.partition, msg: message.value})
            } catch (error) {
                logger.error('Error processing message:' + error)
            } finally {
                try {
                    if (typeof message.commit === 'function') {
                        await withTimeout(message.commit(), 5000)
                    }
                } catch (e) {
                    logger.error('Kafka commit failed:' + e)
                }
                stream.resume()
            }
        })

        stream.on('error', (err) => {
            if (recreateTimer) return
            logger.error('Kafka Stream runtime error:' + err + ', will recreate in 3s')
            recreateTimer = setTimeout(() => {
                recreateTimer = null
                createStream().catch(err => logger.error('Failed to recreate stream:' + err))
            }, 3000)
        })

        stream.on('end', () => {
            if (recreateTimer) return
            logger.warn('Stream ended, will recreate in 3s')
            recreateTimer = setTimeout(() => {
                recreateTimer = null
                createStream().catch(err => logger.error('Failed to recreate stream:' + err))
            }, 3000)
        })

        activeStream = stream
        logger.info('Consumer stream created successfully')
        return stream
    }

    await createStream()

    consumer.on('consumer:group:rebalance', () => {
        logger.warn('Kafka rebalance in progress')
    })

    consumer.on('consumer:group:join', () => {
        logger.info('Kafka rebalance completed, creating new stream to fetch fresh data')
        createStream().catch(err => logger.error('Failed to create stream after rebalance:' + err))
    })

    return consumer
}

/**
 * 进程出错时消费者错误处理
 * @param {Object} consumer 消费者对象
 */
function registerErrorHandler(consumer) {
    for (let type of ['unhandledRejection', 'uncaughtException']) {
        process.on(type, async e => {
            try {
                logger.error(`process.on ${type}`)
                logger.error(e)
                await consumer.close()
            } finally {
                process.exit(1)
            }
        })
    }

    for (let type of ['SIGTERM', 'SIGINT']) {
        process.once(type, async () => {
            logger.warn(`Received ${type}, closing consumer gracefully`)
            try {
                await consumer.close()
            } catch (err) {
                logger.error(`Error closing consumer on ${type}: ${err}`)
            } finally {
                process.exit(0)
            }
        })
    }
}

export async function listAllGroups() {
    const admin = new Admin({
        ...defaultClient
    })
    console.log(await admin.listGroups())
}