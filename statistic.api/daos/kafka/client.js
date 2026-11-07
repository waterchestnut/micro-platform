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
 * @param {String} [msgs.topic] topic
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
            if (idx > -1) {
                const [stale] = producerList.splice(idx, 1)
                // 必须先close再剔除：只删引用会让旧Producer的socket/SASL/重试缓冲永久驻留（proposals/kafka-client-stream-leak）
                try {
                    await stale.producer.close()
                } catch (e) {
                    logger.error('关闭失效producer出错：' + e)
                }
            }
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
 * 流重建互斥约定（proposals/kafka-client-stream-leak）：
 * 任一时刻只允许一条建流在途；旧流必须先destroy并等到close再建新流，
 * 否则error定时器与rebalance-join并发建流时只会有一条被activeStream记住，
 * 另一条成为永远无人销毁的"孤儿流"（持有fetch缓冲并重复消费，数天内可达GB级）。
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
    let creating = null
    let stopping = false
    let commitFailures = 0
    consumer.on('error', err => {
        // 库在心跳rejoin失败时会上抛'error'，无监听会变成未处理事件（proposals/kafka-client-stream-leak）
        logger.error('Kafka consumer error:' + err)
    })
    consumer.once('client:close', () => {
        stopping = true
        if (recreateTimer) {
            clearTimeout(recreateTimer)
            recreateTimer = null
        }
    })
    const withTimeout = (promise, ms) => {
        let timer = null
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Kafka commit timeout')), ms)
            })
        ]).finally(() => clearTimeout(timer))
    }

    async function createStream() {
        if (stopping) return null
        if (creating) return creating // 已有建流在途，复用同一Promise（互斥，防孤儿流）
        creating = (async () => {
            try {
                const old = activeStream
                if (old && !old.destroyed) {
                    activeStream = null
                    // 销毁旧流并等到close，避免新旧两条流并存重复消费/重复commit
                    await new Promise(resolve => {
                        old.once('close', resolve)
                        old.destroy()
                        setTimeout(resolve, 3000) // 兜底：close不来也不能卡死重建
                    })
                }
                if (stopping) return null

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
                                commitFailures = 0
                            }
                        } catch (e) {
                            logger.error('Kafka commit failed:' + e)
                            // 连续commit失败≈membership已丢失（broker端组显示EMPTY但fetch不受校验、进程还在消费）；
                            // 心跳rejoin失败后库不会再自愈，这里强制重建流触发重新入组（proposals/kafka-client-stream-leak）
                            if (++commitFailures >= 3) {
                                commitFailures = 0
                                logger.warn('Kafka commit连续失败，疑似丢失组成员身份，强制重建流以重新入组')
                                createStream().catch(err => logger.error('Failed to recreate stream:' + err))
                            }
                        }
                        if (!stream.destroyed) stream.resume()
                    }
                })

                stream.on('error', (err) => {
                    if (stopping || activeStream !== stream) return // 已被替换的旧流，错误直接丢弃
                    if (recreateTimer) return
                    logger.error('Kafka Stream runtime error:' + err + ', will recreate in 3s')
                    recreateTimer = setTimeout(() => {
                        recreateTimer = null
                        createStream().catch(err => logger.error('Failed to recreate stream:' + err))
                    }, 3000)
                })

                stream.on('end', () => {
                    if (stopping || activeStream !== stream) return
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
            } finally {
                creating = null
            }
        })()
        return creating
    }

    await createStream()

    consumer.on('consumer:group:rebalance', () => {
        logger.warn('Kafka rebalance in progress')
    })

    consumer.on('consumer:group:join', () => {
        // 当前流健在就不重建（库内部会随rebalance刷新分配）；重建本身是竞态/重复消费窗口，
        // 只有流已丢失/已销毁时才补建（proposals/kafka-client-stream-leak）
        if (stopping || (activeStream && !activeStream.destroyed)) return
        logger.info('Kafka rebalance completed, no active stream, creating new stream')
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
        process.once(type, async e => {
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
