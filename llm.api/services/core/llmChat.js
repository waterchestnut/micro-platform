/**
 * @fileOverview 大模型会话聊天相关的操作
 * @author xianyang 2025/11/15
 * @module
 */

import {OpenAI} from 'openai'
import retSchema from '../../daos/retSchema.js'
import conversationDac from '../../daos/core/dac/conversationDac.js'
import llmChannelDataSet from '../../conf/llmChannel.js'
import tmplParse from 'json-templates'
import {llmRagSearch} from '../../grpc/clients/resourceRag.js'
import messageDac from '../../daos/core/dac/messageDac.js'
import {waitTime} from '../../tools/index.js'
import {getAnswerCache, saveAnswerCache} from './answerCache.js'
import {calcTextTokenCount} from '../openai/util.js'
import {getMessages} from './message.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const defaultLlmConfigKey = 'deepseek31'
const defaultLlmVLConfigKey = 'qwenVLPlus'
const defaultChannel = 'xxzx_common'
const defaultChannelGroup = 'none'

/**
 * @description 执行用户通用聊天
 * @author xianyang
 * @param {Object} curUserInfo 当前登录用户信息
 * @param {String} query 用户问题
 * @param {String} conversationCode 会话标识
 * @param {Object} [options] 附加参数
 * @returns {Promise<String>} Markdown格式的大模型返回文本
 */
export async function execChat(curUserInfo, query, conversationCode, options = {}) {
    /*mock*/
    /*options.streamCallback(JSON.stringify({
        content: '1',
        role: 'assistant'
    }))
    await waitTime(2000)
    options.streamCallback(JSON.stringify({
        content: '2',
        role: 'assistant'
    }))
    options.streamCallback('done')
    return 'done'*/

    let defaultKey = options?.inputs?.length ? defaultLlmVLConfigKey : defaultLlmConfigKey
    const llmConfig = config.models[options.llmModel] || config.models[defaultKey]
    const channel = options.channel || defaultChannel
    const channelGroup = options.channelGroup || defaultChannelGroup
    const llmChannelData = llmChannelDataSet[channel] || {}
    const llmModel = options.llmModel || defaultKey

    let conversationInfo = await conversationDac.getByCode(conversationCode)
    if (!conversationInfo) {
        conversationInfo = await conversationDac.add({
            conversationCode,
            title: query.slice(0, 20),
            channel,
            channelGroup,
            conversationType: 'chat',
            llmModel,
            operator: {
                userCode: curUserInfo.userCode,
                realName: curUserInfo.realName
            },
            status: 0
        })
    }

    let messageCode = options.messageCode || tools.getUUID()
    let messages = []

    if (options.cache && options.channelCacheKey) {
        /*从缓存加载回答*/
        let cacheInfo = await getAnswerCache(query, channel, options.channelCacheKey, llmModel)
        if (cacheInfo) {
            options.streamCallback(JSON.stringify({
                role: 'assistant',
                content: cacheInfo.answer,
                reasoning_content: cacheInfo.answerReasoning,
                messageCode
            }))
            await saveMessage(query, messageCode, messages, conversationCode, channel, channelGroup, llmModel, cacheInfo.answer, cacheInfo.answerReasoning, curUserInfo, {
                ...options,
                answerCacheCode: cacheInfo.answerCacheCode,
                answerFromCache: true,
                answerTokens: cacheInfo.answerTokens,
            })
            return 'done'
        }
    }

    if (llmChannelData.sysPrompt) {
        let template = tmplParse(llmChannelData.sysPrompt)
        messages.push({
            'role': 'system',
            'content': template(options.llmParams)
        })
    }
    if (llmChannelData.ragPrompt) {
        let segList = await llmRagSearch(query, options.ragParams?.resCode, options.ragParams || {})
        if (segList?.length) {
            let template = tmplParse(llmChannelData.ragPrompt)
            messages.push({
                'role': 'user',
                'content': template({...options.ragParams, segs: segList.map(_ => _.content).join('\n\n')})
            })
        }
    }
    messages = await appendHistoryMessages(conversationCode, messages, 20000)
    if (options.inputs?.length) {
        messages.push({
            'role': 'user',
            'content': options.inputs.concat({
                type: 'text',
                text: query
            })
        })

    } else {
        messages.push({
            'role': 'user',
            'content': query
        })
    }

    const openai = new OpenAI({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
    })
    let createBody = {
        model: llmConfig.model,
        messages,
        max_tokens: llmConfig.maxTokens,
        temperature: llmConfig.temperature,
        stream: true,
    }
    let chatStream = await openai.chat.completions.create(createBody)
    let answerContent = ''
    let answerReasoning = ''
    let answerList = []
    for await (const chunk of chatStream) {
        //answerList.push(chunk)
        const content = chunk.choices[0]?.delta?.content || ''
        const reasoningContent = chunk.choices[0]?.delta?.reasoning_content || ''
        answerContent += content
        answerReasoning += reasoningContent
        options.streamCallback(JSON.stringify({...chunk.choices[0]?.delta, messageCode}))
    }

    let messageTokens = calcTextTokenCount(messages.map(_ => _.content).join('\n'))
    let answerTokens = calcTextTokenCount(answerContent + answerReasoning)
    await saveMessage(query, messageCode, messages, conversationCode, channel, channelGroup, llmModel, answerContent, answerReasoning, curUserInfo, {
        ...options,
        answerList,
        messageTokens,
        answerTokens
    })

    if (options.cache && options.channelCacheKey) {
        /*缓存大模型回答*/
        await saveAnswerCache(query, channel, options.channelCacheKey, llmModel, {
            sourceConversationCode: conversationCode,
            sourceMessageCode: messageCode,
            answer: answerContent,
            answerReasoning,
            operator: {
                userCode: curUserInfo.userCode,
                realName: curUserInfo.realName
            },
            answerTokens,
        })
    }

    return 'done'
}

/*保存会话消息*/
async function saveMessage(query, messageCode, messages, conversationCode, channel, channelGroup, llmModel, answerContent, answerReasoning, curUserInfo, options) {
    await messageDac.add({
        messageCode,
        conversationCode,
        channel,
        channelGroup,
        llmModel,
        llmParams: options.llmParams,
        ragParams: options.ragParams,
        query,
        inputs: options.inputs || [],
        messages,
        answer: answerContent,
        progress: 'finish',
        operator: {
            userCode: curUserInfo.userCode,
            realName: curUserInfo.realName
        },
        status: 0,
        answerReasoning,
        answerFromCache: options.answerFromCache,
        answerCacheCode: options.answerCacheCode,
        extInfo: {
            answerList: options.answerList
        },
        messageTokens: options.messageTokens,
        answerTokens: options.answerTokens
    })
}

/*附加聊天的历史记录*/
async function appendHistoryMessages(conversationCode, messages, maxTokens = 20000) {
    let messageTokens = calcTextTokenCount(messages.map(_ => _.content).join('\n'))
    if (messageTokens >= maxTokens) {
        return messages
    }
    let list = (await getMessages({conversationCode}, 1, 10, {sort: {insertTime: -1}})).rows
    if (!list?.length) {
        return messages
    }
    let historyMessages = []
    for (let i = 0; i < list.length; i++) {
        let messageInfo = list[i]
        let query = messageInfo.query
        let answer = messageInfo.answer
        if (!query || !answer) {
            continue
        }
        messageTokens += calcTextTokenCount(query + '\n' + answer)
        if (messageTokens >= maxTokens) {
            break
        }
        historyMessages.unshift({
            role: 'assistant',
            content: answer,
        })
        historyMessages.unshift({
            role: 'user',
            content: query,
        })
    }
    return messages.concat(historyMessages)
}
