/**
 * @fileOverview 记忆采集（L0 原始事件）
 * @module services/core/memory/capture
 * @description 采集失败绝不影响聊天：本模块所有对外函数都不得抛出，只记日志。
 * 是否采集只看 provenance 的结构化标记，不看"像不像报错"的关键词。
 */

import memoryEventDac from '../../../daos/core/dac/memoryEventDac.js'
import {calcTextTokenCount} from '../../openai/util.js'
import {isMemoryEnabled, resolveNamespace} from './namespace.js'
import {shouldCapture} from './policy.js'
import {enqueueExtract} from './queue.js'
import {maskPii, piiSummary} from '../../../tools/pii.js'

const config = llm.config
const logger = llm.logger

export {shouldCapture, isMemoryEnabled} from './policy.js'

/** 攒够几条事件再触发一次抽取，避免每轮都起一个后台任务 */
const EXTRACT_BATCH_MIN = 1

/**
 * @description 写入一条记忆原始事件
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.curUserInfo 当前登录用户
 * @param {String} params.channel 频道
 * @param {String} [params.workspaceId] 沙箱工作区
 * @param {String} params.conversationCode 会话标识
 * @param {String} params.messageCode 消息标识
 * @param {String} params.role user|assistant|tool
 * @param {String} params.content 文本
 * @param {Object} [params.provenance] 来源标记
 * @param {Boolean} [params.explicitSave] 显式保存
 * @returns {Promise<Object|null>} 事件记录，未采集或失败返回 null
 */
export async function captureEvent(params = {}) {
    const {
        curUserInfo, channel, workspaceId = null, conversationCode, messageCode,
        role, content, provenance = {}, explicitSave = false,
    } = params

    if (!isMemoryEnabled({
        channel,
        conversationType: params.conversationType,
        options: params.options,
        channelMemory: params.channelMemory,
    })) {
        return null
    }
    if (!shouldCapture({content, provenance, explicitSave})) {
        return null
    }
    try {
        const ns = await resolveNamespace({
            userCode: curUserInfo?.userCode,
            channel,
            workspaceId,
            operator: curUserInfo,
        })
        if (!ns) {
            return null
        }
        /**
         * 入库前脱敏：一旦密钥/手机号/身份证号进了 memoryEvent，
         * 之后的召回注入会把它反复带到模型那里，删不干净。
         */
        const safe = maskPii(content)
        if (safe.masked) {
            logger.warn(`记忆采集已脱敏(${piiSummary(safe.hits)}) userCode=${curUserInfo?.userCode}`)
        }
        const doc = {
            userCode: ns.userCode,
            channel: ns.channel,
            workspaceId: ns.workspaceId || null,
            conversationCode,
            messageCode,
            role,
            content: safe.text,
            tokens: calcTextTokenCount(safe.text, config.models?.[params.llmModel]?.tokenizer),
            /** 默认不可检索：走 Kafka 抽取，走审核才生效；显式保存直接生效 */
            state: explicitSave ? 'active' : 'review',
            provenance: {
                runtimeError: !!provenance.runtimeError,
                captureExclude: !!provenance.captureExclude,
                userSaved: !!explicitSave,
                piiMasked: !!safe.masked,
                piiTypes: safe.hits.map(h => h.type).filter((v, i, a) => a.indexOf(v) === i),
            },
            operator: {userCode: curUserInfo?.userCode, realName: curUserInfo?.realName},
        }
        return await memoryEventDac.add(doc)
    } catch (e) {
        logger.error(`记忆事件采集失败(${channel}/${curUserInfo?.userCode}): ${e.message}`)
        return null
    }
}

/**
 * @description 一轮对话结束后采集问答两侧内容，并投递一次抽取任务；不抛错、不阻塞聊天
 * @author xianyang
 * @param {Object} params 入参
 * @returns {Promise<Object>} 采集与投递结果
 */
export async function captureTurn(params = {}) {
    const {query, answer, answerReasoning, channel, curUserInfo} = params
    const collected = await Promise.all([
        captureEvent({...params, role: 'user', content: query}),
        captureEvent({...params, role: 'assistant', content: answer}),
        captureEvent({...params, role: 'assistant', content: answerReasoning}),
    ])
    const eventCodes = collected.filter(Boolean).map(_ => _.eventCode)
    let enqueued = false
    if (eventCodes.length >= EXTRACT_BATCH_MIN && params.channelMemory?.capture !== false) {
        enqueued = await enqueueExtract({
            userCode: curUserInfo?.userCode,
            channel,
            workspaceId: params.workspaceId || null,
            conversationCode: params.conversationCode,
            messageCode: params.messageCode,
            eventCodes,
        })
    }
    return {captured: eventCodes.length, enqueued}
}

/**
 * @description 显式保存一条记忆：不经模型抽取，直接事件+晋升，立即可被召回
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.curUserInfo 当前用户
 * @param {String} params.channel 频道
 * @param {String} params.content 要记住的内容
 * @param {String} [params.topic] 主题
 * @param {String} [params.conversationCode] 来源会话
 * @param {String} [params.messageCode] 来源消息
 * @returns {Promise<Object>} {ok, atomCode, reason}
 */
export async function saveExplicit({
    curUserInfo, channel, workspaceId = null, content, topic = 'general',
    conversationCode, messageCode, llmModel,
} = {}) {
    const event = await captureEvent({
        curUserInfo, channel, workspaceId, conversationCode, messageCode, llmModel,
        role: 'user', content, explicitSave: true,
        channelMemory: {enabled: true, capture: true},
    })
    if (!event) {
        return {ok: false, reason: 'not_captured'}
    }
    try {
        const {promoteCandidate} = await import('./promote.js')
        /**
         * 必须用事件里已脱敏的正文，而不是入参原文：
         * 原子是最终会被注入提示词的东西，事件脱敏了、原子没脱敏等于白做（实测泄漏过一次）。
         */
        const safeContent = event.content || content
        const ret = await promoteCandidate({
            candidate: {
                content: safeContent,
                kind: 'preference',
                topic,
                /** 用户显式保存，置信度为 1，且 source 使其不受自动阈值约束 */
                confidence: 1,
                evidence: [{eventCode: event.eventCode, quote: safeContent}],
                eventCodes: [event.eventCode],
                entities: [],
                source: 'user_save',
            },
            userCode: event.userCode,
            channel: event.channel,
            workspaceId: event.workspaceId || null,
            operator: curUserInfo,
        })
        return {ok: !!ret?.atomCode, ...ret}
    } catch (e) {
        logger.error(`显式保存记忆失败(${channel}/${curUserInfo?.userCode}): ${e.message}`)
        return {ok: false, reason: e.message}
    }
}
