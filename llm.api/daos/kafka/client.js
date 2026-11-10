/**
 * @fileOverview kafka的相关客户端操作
 * @author xianyang
 * @module
 */

import {Producer, stringSerializers, Consumer, stringDeserializers, Admin} from '@platformatic/kafka'
import {createDrainController, resolveDrainBudget} from '../core/policy/drainPolicy.js'

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

    let activeStream = null
    let recreateTimer = null

    /**
     * 停机排空控制器（判据与源仓同一份：daos/core/policy/drainPolicy.js）。
     * 为什么不能照抄源仓整个文件：底座这份 kafka client 是另一代实现（没有 stopping / 重建互斥），
     * 只把"排空"这一层差量接上，其余保持原样 —— 混着搬会把未经验证的改动一起带进来。
     */
    const drain = createDrainController()

    registerErrorHandler(consumer, {
        /**
         * @description 收到信号后的排空动作（必须先于 close）
         * @param {String} signal 信号名
         * @returns {Promise<Object>} 排空结果
         */
        onSignal: async (signal) => {
            const budget = resolveDrainBudget({
                envValue: process.env.KAFKA_DRAIN_TIMEOUT_MS,
                terminationGraceSeconds: process.env.TERM_GRACE_PERIOD_SECONDS,
                preStopSeconds: process.env.PRE_STOP_SECONDS,
            })
            const snap = drain.beginDraining()
            if (activeStream && !activeStream.destroyed) {
                activeStream.pause()
            }
            const r = await drain.waitForDrain(budget.budgetMs)
            /**
             * 排空之后、close 之前必须 destroy 流：只 pause 时 close 会报
             * `Cannot leave group while consuming messages`（源仓 dev 实测），等于没干净退组。
             * destroy 一定在 waitForDrain 之后 —— 早一步就掐断了正在提交的位点。
             */
            const dying = activeStream
            if (dying && !dying.destroyed) {
                await new Promise(resolve => {
                    dying.once('close', resolve)
                    dying.destroy()
                    setTimeout(resolve, 2000)
                })
            }
            logger.warn(`Kafka 停机排空: signal=${signal} 预算=${budget.budgetMs}ms(${budget.reason}, env采纳=${budget.applied}) `
                + `置位时在途=${snap.wasInFlight} 结果=${r.drained ? '已排空' : '超时未排空'} 等待=${r.waitedMs}ms `
                + `流已销毁=${dying ? String(!!dying.destroyed) : '无流'} `
                + `未提交=${JSON.stringify(r.pending)}${r.pending.length ? ' ⇒ 这些消息会被其他成员重跑（at-least-once）' : ''}`)
            return r
        },
    })

    const withTimeout = (promise, ms) => {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Kafka commit timeout')), ms))
        ])
    }

    async function createStream() {
        /** 排空期间不再建流：建了就会继续向 broker 要活（分发消息时也会被拒，但那已经是浪费） */
        if (drain.draining) return null
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
            const ref = `${message.topic}/${message.partition}/${message.offset}`
            if (!drain.start(ref)) {
                /**
                 * 停机中：不处理也**不提交**。提交等于把没干过的活标记成干过（那才是真丢消息）；
                 * 位点留在原地，leave group 之后由别的成员取走。
                 */
                logger.warn(`Kafka 停机中，不接新消息（offset 不提交，留给其他成员）: ${ref}`)
                stream.pause()
                return
            }
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
                /** finish 在 commit 之后：排空的定义是"活干完且位点提交已尝试"，不是"callback 返回了" */
                drain.finish(ref)
                if (!drain.draining) stream.resume()
            }
        })

        stream.on('error', (err) => {
            if (drain.draining || recreateTimer) return
            logger.error('Kafka Stream runtime error:' + err + ', will recreate in 3s')
            recreateTimer = setTimeout(() => {
                recreateTimer = null
                createStream().catch(err => logger.error('Failed to recreate stream:' + err))
            }, 3000)
        })

        stream.on('end', () => {
            if (drain.draining || recreateTimer) return
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
        /** createStream 里也有同样的守卫；这里先返回是为了不打那句误导性的 info */
        if (drain.draining) return
        logger.info('Kafka rebalance completed, creating new stream to fetch fresh data')
        createStream().catch(err => logger.error('Failed to create stream after rebalance:' + err))
    })

    return consumer
}

/**
 * 进程出错时消费者错误处理
 * @param {Object} consumer 消费者对象
 * @param {Object} [hooks] 停机钩子
 * @param {Function} [hooks.onSignal] 收到 SIGTERM/SIGINT 时**先于 close** 执行的排空动作
 * @param {Function} [hooks.exit] 退出动作（默认 process.exit；仅测试注入，用于断言真实顺序）
 */
function registerErrorHandler(consumer, hooks = {}) {
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
                if (typeof hooks.onSignal === 'function') {
                    try {
                        await hooks.onSignal(type)
                    } catch (e) {
                        /** 排空异常不能吃掉 close：不 leave group 就要白等 sessionTimeout 30s */
                        logger.error(`Kafka 停机排空异常（继续 close 以触发重新分配）: ${e.stack || e}`)
                    }
                }
                await consumer.close()
            } catch (err) {
                logger.error(`Error closing consumer on ${type}: ${err}`)
            } finally {
                /** 退出动作可注入：会 process.exit 的函数没法被测（顺序断言需要一个记账替身） */
                ;(hooks.exit || ((code) => process.exit(code)))(0)
            }
        })
    }
}

/**
 * 导出只为一条测试：`先排空 → 再 close → 才退出` 是核心不变量，
 * 不导出就只能靠读代码相信它。
 */
export {registerErrorHandler}

export async function listAllGroups() {
    const admin = new Admin({
        ...defaultClient
    })
    console.log(await admin.listGroups())
}