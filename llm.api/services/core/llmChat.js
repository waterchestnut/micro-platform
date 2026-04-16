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
import {mcpToolManager} from '../../mcp/index.js'
import {SkillChat} from '../../skill/skillChat.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const defaultLlmConfigKey = 'qwenPlus'
const defaultLlmVLConfigKey = 'qwenVLPlus'
const defaultChannel = 'micro_common'
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
            status: 0,
            userCodes: [curUserInfo.userCode]
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

    // 匹配并注入 Agent Skills 上下文（基于频道配置，分级加载）
    const skillChat = new SkillChat(channel, curUserInfo)
    let skillContext = null
    try {
        // 初始化 Skills 聊天上下文
        const {prompt, context} = await skillChat.initSkillChatContext(query, {
            ...options,
            loadMode: options.skillLoadMode || 'candidates',
            context: {channel, channelGroup, llmModel}
        })

        skillContext = context

        if (prompt) {
            messages.push({
                'role': 'system',
                'content': prompt
            })
            logger.info(`已注入 ${skillContext.candidates.length} 个候选 Skills`)
        }
    } catch (error) {
        logger.warn(`Skills 初始化失败: ${error.message}`)
        // Skills 初始化失败不影响主流程
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

    // 检查当前频道是否启用了MCP工具
    const hasMcpTools = await mcpToolManager.hasTools(channel)
    let createBody = {
        model: llmConfig.model,
        messages,
        max_tokens: llmConfig.maxTokens,
        temperature: llmConfig.temperature,
        stream: true, // 启用流式输出
        // 深度思考
        ...(options.enableThinking && llmConfig.enableThinking ? llmConfig.enableThinking : {enable_thinking: false}),
    }

    // 合并所有可用工具（MCP工具 + Skill工具）
    const allTools = []

    // 如果有MCP工具且当前频道启用了MCP，则添加工具
    if (hasMcpTools) {
        const mcpTools = await mcpToolManager.getTools(channel)
        if (mcpTools.length > 0) {
            allTools.push(...mcpTools)
        }
    }

    // 添加 Skill 执行工具
    if (skillContext && skillContext.tools.length > 0) {
        allTools.push(...skillContext.tools)
    }

    // 如果有工具，添加到请求体
    if (allTools.length > 0) {
        createBody.tools = allTools
        createBody.tool_choice = 'auto' // 让模型自动选择何时使用工具
    }

    let answerContent = ''
    let answerReasoning = ''
    let answerList = []

    // 最多迭代6次，用于处理工具调用
    let iterationCount = 0
    const maxIterations = 6

    while (iterationCount < maxIterations) {
        if (options.signal?.aborted) {
            return 'aborted'
        }

        iterationCount++
        //console.log(`createBody ${JSON.stringify(createBody)}`)
        let chatStream = await openai.chat.completions.create(createBody, {signal: options.signal})

        let toolCalls = []      // 用于收集工具调用
        let currentToolCall = null
        let receivedToolCall = false

        // 处理流式响应
        for await (const chunk of chatStream) {
            const choice = chunk.choices[0]
            if (!choice) continue

            // 检查是否有工具调用
            if (choice.delta?.tool_calls) {
                receivedToolCall = true
                for (const toolCallDelta of choice.delta.tool_calls) {
                    if (toolCallDelta.index !== undefined) {
                        // 扩展或初始化工具调用数组
                        while (toolCalls.length <= toolCallDelta.index) {
                            toolCalls.push({
                                id: '',
                                function: {name: '', arguments: ''},
                                type: 'function'
                            })
                        }

                        currentToolCall = toolCalls[toolCallDelta.index]

                        if (toolCallDelta.id) {
                            currentToolCall.id = toolCallDelta.id
                        }
                        if (toolCallDelta.function?.name) {
                            currentToolCall.function.name = currentToolCall.function.name + toolCallDelta.function.name
                        }
                        if (toolCallDelta.function?.arguments) {
                            currentToolCall.function.arguments = currentToolCall.function.arguments + toolCallDelta.function.arguments
                        }
                    }
                }
            } else {
                // 处理普通内容和推理内容
                const content = choice.delta?.content || ''
                const reasoningContent = choice.delta?.reasoning_content || ''
                answerContent += content
                answerReasoning += reasoningContent
                options.streamCallback(JSON.stringify({role: 'assistant', ...choice?.delta, messageCode}))
            }
        }

        // 检查大模型是否选择了某个技能（动态加载机制）
        if (!receivedToolCall && answerContent && skillContext) {
            const selectedSkill = await skillChat.checkSkillSelection(answerContent, skillContext)
            if (selectedSkill) {
                // 追加技能详细说明到消息
                messages.push({
                    role: 'system',
                    content: selectedSkill.prompt
                })

                // 如果有工具，也添加到请求中
                if (selectedSkill.tools.length > 0) {
                    createBody.tools = [...(createBody.tools || []), ...selectedSkill.tools]
                }

                logger.info(`动态加载技能详情: ${selectedSkill.name}`)

                // 重置内容并重新请求
                answerContent && answerList.push(answerContent)
                answerContent = ''
                // 通知调用端回答内容需要重置
                options.streamCallback && options.streamCallback(JSON.stringify({
                    role: 'tool',
                    content: '回答内容重置',
                    tool_call_id: 'clear_answer_content',
                    messageCode
                }))
                continue
            }
        }

        // 如果收到了工具调用，处理它们
        if (receivedToolCall && toolCalls.length > 0) {
            // 过滤掉空的工具调用
            toolCalls = toolCalls.filter(tc => tc.id && tc.function.name)

            if (toolCalls.length > 0) {
                // 添加助手的消息到对话历史（包含工具调用请求）
                const assistantMessage = {
                    role: 'assistant',
                    content: null, // 工具调用时内容可能为空
                    tool_calls: toolCalls
                }
                messages.push(assistantMessage)

                // 执行工具调用（区分 MCP 工具和 Skill 工具）
                const toolResults = skillContext
                    ? await skillChat.executeSkillToolCalls(toolCalls, skillContext)
                    : await mcpToolManager.executeToolCalls(channel, toolCalls)

                // 将工具调用结果添加到消息历史中
                for (const toolResult of toolResults) {
                    messages.push(toolResult)

                    // 发送工具调用结果作为流式数据
                    /*if (options.streamCallback) {
                        options.streamCallback(JSON.stringify({
                            role: 'tool',
                            content: toolResult.content,
                            tool_call_id: toolResult.tool_call_id,
                            messageCode
                        }))
                    }*/
                }

                // 重置内容变量为下一次迭代做准备
                answerContent && answerList.push(answerContent)
                answerContent = ''
                // 通知调用端回答内容需要重置
                options.streamCallback && options.streamCallback(JSON.stringify({
                    role: 'tool',
                    content: '回答内容重置',
                    tool_call_id: 'clear_answer_content',
                    messageCode
                }))
                continue
            }
        }

        // 如果没有工具调用或者没有更多工具需要调用，退出循环
        break
    }

    if (options.signal?.aborted) {
        return 'aborted'
    }

    let messageTokens = calcTextTokenCount(messages.map(_ => _.content).join('\n'))
    let answerTokens = calcTextTokenCount(answerContent + answerReasoning)
    await saveMessage(query, messageCode, messages, conversationCode, channel, channelGroup, llmModel, answerContent, answerReasoning, curUserInfo, {
        ...options,
        answerList,
        messageTokens,
        answerTokens,
        tools: createBody.tools,
        toolChoice: createBody.tool_choice,
        iterationCount: iterationCount,
        skills: skillContext ? skillChat.getSkillStats(skillContext) : null
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
            answerList: options.answerList,
            tools: options.tools,
            toolChoice: options.toolChoice,
            iterationCount: options.iterationCount,
            skills: options.skills
        },
        messageTokens: options.messageTokens,
        answerTokens: options.answerTokens,
        attachments: options.attachments,
        answerAttachments: options.answerAttachments,
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
