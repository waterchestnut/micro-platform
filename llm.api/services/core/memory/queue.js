/**
 * @fileOverview 记忆抽取任务队列
 * @module services/core/memory/queue
 * @description 消息体只放指针，正文由消费者回查 Mongo，避免把大段文本塞进 Kafka
 * （现有 agentTask 的载荷内嵌整个 messages 数组，已经踩过 maxBytes 的坑）。
 * 投递失败绝不影响聊天：内部吞错，只记日志。
 */

import {sendMessage, createClient} from '../../../daos/kafka/client.js'
import {acquireOnce} from '../../../daos/cache/l2Cache.js'
import {md5} from '../../../tools/security.js'

const config = llm.config
const logger = llm.logger

let defaultClient = null

function client() {
    if (!defaultClient) {
        defaultClient = createClient('memoryQueue')
    }
    return defaultClient
}

/**
 * @description 抽取任务的去重键：同一批事件在窗口内只投一次
 * 单次抽取实测 80s，用户连发几条消息会让同一批事件被反复投递，白烧 token。
 * 重试（attempt>0）不去重，否则失败重投会被自己上一次的锁挡住。
 * @author xianyang
 * @param {Object} job 任务
 * @returns {String} 去重键
 */
export function extractDedupeKey(job) {
    const codes = [...new Set((job?.eventCodes || []).filter(Boolean))].sort().join(',')
    /** workspaceId 进键：同一批事件在不同分区的投递不是重复（PR-16 ③） */
    return `mem:extract:${job?.userCode || '-'}:${job?.channel || '-'}:${job?.workspaceId || '-'}:${md5(codes)}`
}

/**
 * @description 投递一次抽取任务
 * @author xianyang
 * @param {Object} job 任务
 * @param {String} job.userCode 用户标识
 * @param {String} job.channel 频道
 * @param {String} [job.conversationCode] 会话标识
 * @param {String} [job.messageCode] 消息标识
 * @param {String[]} job.eventCodes 待抽取事件标识
 * @param {Number} [job.attempt] 第几次投递，从 0 开始
 * @returns {Promise<Boolean>} 是否投递成功
 */
export async function enqueueExtract(job) {
    const topic = config.kafka?.topics?.memoryExtract?.topic
    if (!topic || !job?.eventCodes?.length) {
        return false
    }
    const window = Number(config.cache?.extractDedupeSeconds ?? 60)
    if (!job.attempt && window > 0) {
        const got = await acquireOnce(extractDedupeKey(job), window)
        if (!got) {
            logger.info(`抽取任务在 ${window}s 窗口内重复，跳过投递(${job.userCode}/${job.channel})`)
            return false
        }
    }
    try {
        await sendMessage([{
            topic,
            key: `${job.userCode}|${job.channel}`,
            value: JSON.stringify({...job, attempt: job.attempt || 0, enqueuedAt: Date.now()}),
        }], client())
        return true
    } catch (e) {
        logger.error(`记忆抽取任务投递失败(${job?.userCode}/${job?.channel}): ${e.message}`)
        return false
    }
}

/**
 * @description 重试耗尽后落死信，保证"不静默丢弃"
 * @author xianyang
 * @param {Object} job 原任务
 * @param {Error|String} error 失败原因
 * @returns {Promise<Boolean>} 是否投递成功
 */
export async function publishDlq(job, error) {
    const topic = config.kafka?.topics?.memoryExtractDlq?.topic
    if (!topic) {
        logger.error(`未配置死信 topic，记忆抽取任务被放弃: ${JSON.stringify(job)}`)
        return false
    }
    try {
        await sendMessage([{
            topic,
            key: `${job?.userCode}|${job?.channel}`,
            value: JSON.stringify({
                ...job,
                error: error?.message || String(error),
                errorName: error?.name,
                failedAt: Date.now(),
            }),
        }], client())
        return true
    } catch (e) {
        /** 死信也发不出去时只能落日志，但必须留下完整任务体以便人工重放 */
        logger.error(`记忆抽取死信投递失败，任务体=${JSON.stringify(job)} 错误=${e.message}`)
        return false
    }
}
