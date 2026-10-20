/**
 * @fileOverview 记忆抽取异步处理
 * @module consumers/memoryExtractor
 * @description 与既有消费者的三处差异是刻意的：
 * 1. clientId 取 process.argv[2]，不再把数组拼进模板串；
 * 2. maxBytes 给到 4MB，不再用会截断任务的 4KB；
 * 3. 失败按 attempt 递增重投、超限落死信，而不是 catch 后 return 让 offset 静默前移。
 *    daos/kafka/client.js 在 finally 里无条件 commit，因此重试必须在本处理器内完成，
 *    否则一旦不 commit，后续成功提交会连带跳过失败消息，等于丢得更隐蔽。
 */

import '../init.js'
import {createClient, subscribe} from '../daos/kafka/client.js'
import redisClient from '../daos/cache/redisClient.js'
import {MessagesStreamModes, MessagesStreamFallbackModes} from '@platformatic/kafka'
import {processExtractJob} from '../services/core/memory/promote.js'
import {enqueueExtract, publishDlq} from '../services/core/memory/queue.js'
import {getChannelMemory} from '../conf/llmChannel.js'
import {startHeartbeat} from '../services/core/memory/health.js'

const logger = llm.logger
const config = llm.config
const kafkaConfig = config.kafka

/** 单条消息在本进程内的最大处理次数，超出即进死信 */
const MAX_INFLIGHT_ATTEMPTS = parseInt(process.env['memory_extract_maxInflightAttempts'] || '3')
const RETRY_BACKOFF_MS = parseInt(process.env['memory_extract_retryBackoffMs'] || '2000')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/** node .\consumers\memoryExtractor.js c1 */
const instanceTag = process.argv[2] || ''
const client = createClient(`memoryExtractor-${instanceTag}`)

/** 本进程累计计数随心跳上报（§6.3 交付物；重启清零可接受，lag 才是主指标） */
const counts = {processed: 0, skipped: 0, failed: 0, requeued: 0, dlq: 0}
startHeartbeat({redis: redisClient, instanceTag, getCounts: () => counts})

async function handle(job) {
    if (!config.memory?.enabled) {
        /** 总开关关闭时直接确认掉，避免任务在 broker 里堆积后被重复处理 */
        logger.info('记忆模块未启用，跳过抽取任务')
        return 'skipped'
    }
    const channelMemory = getChannelMemory(job.channel)
    if (!channelMemory.capture && !channelMemory.enabled) {
        return 'skipped'
    }
    return await processExtractJob(job)
}

subscribe([kafkaConfig.topics.memoryExtract.topic], kafkaConfig.topics.memoryExtract.groupId,
    async ({topic, partition, msg}) => {
        let job = null
        try {
            job = JSON.parse(msg)
        } catch (e) {
            /** 解析不了的消息重投也没救，直接进死信留证 */
            logger.error(`memoryExtractor 消息体无法解析，落死信: ${e.message}`)
            await publishDlq({raw: msg}, e)
            counts.dlq++
            return 'poison'
        }

        let lastError = null
        for (let i = 0; i < MAX_INFLIGHT_ATTEMPTS; i++) {
            try {
                const ret = await handle(job)
                logger.info(`memoryExtractor 完成(${job.userCode}/${job.channel}): ${JSON.stringify(ret)}`)
                if (ret === 'skipped') counts.skipped++
                else counts.processed++
                return ret
            } catch (e) {
                lastError = e
                logger.error(`memoryExtractor 处理失败(${job.userCode}/${job.channel}) 第 ${i + 1} 次: ${e}`)
                if (i < MAX_INFLIGHT_ATTEMPTS - 1) {
                    await sleep(RETRY_BACKOFF_MS * (2 ** i))
                }
            }
        }

        /** 本进程重试耗尽：按 attempt 重新投递，超过上限则落死信，保证既不静默丢也不无限循环 */
        const attempt = (job.attempt || 0) + 1
        const maxRedeliver = parseInt(process.env['memory_extract_maxRedeliver'] || '2')
        if (attempt > maxRedeliver) {
            logger.error(`memoryExtractor 重投 ${attempt - 1} 次仍失败，落死信(${job.userCode}/${job.channel})`)
            await publishDlq({...job, attempt}, lastError)
            counts.dlq++
            return 'dlq'
        }
        await enqueueExtract({...job, attempt})
        logger.warn(`memoryExtractor 已重新入队(attempt=${attempt})(${job.userCode}/${job.channel})`)
        counts.requeued++
        return 'requeued'
    },
    client, {
        mode: MessagesStreamModes.COMMITTED,
        fallbackMode: MessagesStreamFallbackModes.EARLIEST,
        maxBytes: 4 * 1024 * 1024,
    })
