/**
 * @fileOverview kafka的相关客户端操作
 * @author xianyang
 * @module
 */

import {Producer, stringSerializers, Consumer, stringDeserializers, Admin} from '@platformatic/kafka'
import {createDrainController, resolveDrainBudget} from '../core/policy/drainPolicy.js'

const kafkaConfig = ucenter.config.kafka
const logger = ucenter.logger

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
 * @param {Array<Object>|String} msgsArg 标准形: 消息列表(每项含 topic; 其余字段 key/value/partition/headers/timestamp); 传 String 时为老式兼容形态的 topic
 * @param {Object|String} [groupIdOrClient] 标准形: 客户端配置(缺省用本文件 defaultClient); 老式兼容形态下为 groupId(kafkajs 遗留参数, 忽略即弃)
 * @param {Array<Object>} [msgsLegacy] 仅老式兼容形态生效: 消息列表
 * @param {Object} [clientArg] 仅老式兼容形态生效: 客户端配置
 * @returns {Boolean} 发送是否成功
 * @note 标准形 sendMessage(msgs[, client]); 老式 sendMessage(topic, groupId, msgs, client) 仅作外部/遗漏处兜底, 全生态调用点已标准化, 新代码一律标准形
 */
export const sendMessage = async (msgsArg, groupIdOrClient, msgsLegacy, clientArg) => {
    /**
     * 统一签名: sendMessage(msgs, client)。兼容迁移前的老调用 sendMessage(topic, groupId, msgs, client)
     * (groupId 为 kafkajs 时代遗留参数, 生产者不需要; 各仓 statistic/cron 等调用面广, 兼容层消除改造风险)。
     */
    let msgs, client
    if (typeof msgsArg === 'string') {
        client = clientArg || defaultClient
        msgs = (msgsLegacy || []).map(m => ({topic: msgsArg, ...m}))
    } else {
        client = (groupIdOrClient && !Array.isArray(groupIdOrClient)) ? groupIdOrClient : defaultClient
        msgs = msgsArg
    }
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

    /**
     * 停机排空控制器：`Consumer#close()` 实测只 leave group + 关连接，**不等在途 callback**，
     * 而 close 之后 `message.commit()` 会失败 —— 所以必须"先停止拉新 → 等在途提交 → 再 close"。
     * 顺序颠倒的写法（先 close 再等）看着也在"等"，实际是把干完活的位点丢掉，等于白干一遍。
     */
    const drain = createDrainController()

    let activeStream = null
    let recreateTimer = null
    let creating = null
    let stopping = false
    let commitFailures = 0

    registerErrorHandler(consumer, {
        /**
         * @description 收到信号后的排空动作（在 close 之前跑）
         * @param {String} signal 信号名
         * @returns {Promise<Object>} 排空结果，供处理器写日志
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
             * 排空之后、close 之前必须把流**销毁**，只 pause 不够。
             * 实测证据（dev 现场，`consumer-drain-probe`）：pause 完直接 close 会报
             *   `PLT_KFK_USER: Cannot leave group while consuming messages.`
             * 也就是"干净退组"根本没发生 —— 别的成员只能等连接断开或 sessionTimeout。
             * destroy 放在 waitForDrain 之后是刻意的：早一步就会掐断正在提交的位点。
             * 2s 兜底是必须的：close 事件不来也不能把退出预算吃光。
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
        /**
         * `drain.draining` 也必须挡在这里。理由不是防御性冗余：
         * 我把 close 排到排空之后（否则 commit 会失败），而 `stopping` 是由 `client:close` 置位的 ——
         * 于是"排空期间"这一段里 stopping 还是 false，此时流一旦 error/end，
         * 下面的定时器就会**再建一条新流继续 fetch**。
         * 分发消息时 drain.start() 固然会拒绝，但"停机过程中还在向 broker 要活"这件事本身就该停。
         */
        if (stopping || drain.draining) return null
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
                if (stopping || drain.draining) return null

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
                         * 已经在停机排空：这条**不处理也不提交**。
                         * 不提交是刻意的 —— 位点留在原地，leave group 之后别的成员会取走；
                         * 要是这里顺手 commit 了，就等于把没干过的活标记成干过（真丢消息）。
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
                        /**
                         * finish 放在 commit **之后**：排空完成的定义是"活干完且位点提交已尝试"，
                         * 不是"callback 返回了"。否则 close 会插在 commit 前面，等于白干。
                         */
                        drain.finish(ref)
                        if (!drain.draining && !stream.destroyed) stream.resume()
                    }
                })

                stream.on('error', (err) => {
                    if (stopping || drain.draining || activeStream !== stream) return // 已被替换的旧流，错误直接丢弃
                    if (recreateTimer) return
                    logger.error('Kafka Stream runtime error:' + err + ', will recreate in 3s')
                    recreateTimer = setTimeout(() => {
                        recreateTimer = null
                        createStream().catch(err => logger.error('Failed to recreate stream:' + err))
                    }, 3000)
                })

                stream.on('end', () => {
                    if (stopping || drain.draining || activeStream !== stream) return
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
 * @param {Object} [hooks] 停机钩子
 * @param {Function} [hooks.onSignal] 收到 SIGTERM/SIGINT 时**先于 close** 执行的排空动作
 * @param {Function} [hooks.exit] 退出动作（默认 process.exit；仅测试注入，用于断言真实顺序）
 */
function registerErrorHandler(consumer, hooks = {}) {
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
                /**
                 * 顺序要紧：先排空在途（含 commit），再 close。
                 * close 会 leave group + 关连接，之后再提交必然失败 ——
                 * 那种"看起来等了、其实等到的是一个已经关掉的客户端"的写法是本模块要避免的原型。
                 */
                if (typeof hooks.onSignal === 'function') {
                    try {
                        await hooks.onSignal(type)
                    } catch (e) {
                        /**
                         * 排空自己出错**不能**连带跳过 close：跳过就等于不 leave group，
                         * 组里其他成员要等满 sessionTimeout(30s) 才接管，
                         * 一个已经失败的等待反而把停机拖得更久。
                         */
                        logger.error(`Kafka 停机排空异常（继续 close 以触发重新分配）: ${e.stack || e}`)
                    }
                }
                await consumer.close()
            } catch (err) {
                logger.error(`Error closing consumer on ${type}: ${err}`)
            } finally {
                /**
                 * 退出动作可以从外面换掉：只有一个会 `process.exit` 的函数没法被测。
                 * 生产默认就是 process.exit，测试注入一个记账函数，才能断言"排空 → close → 退出"的真实顺序。
                 */
                ;(hooks.exit || ((code) => process.exit(code)))(0)
            }
        })
    }
}

/**
 * 导出只为一条测试：`先排空 → 再 close → 才退出` 是这次改动的核心不变量，
 * 不导出就只能靠读代码相信它，而读代码这件事我今天已经错过几次了。
 */
export {registerErrorHandler}
export async function listAllGroups() {
    const admin = new Admin({
        ...defaultClient
    })
    console.log(await admin.listGroups())
}
