/**
 * @fileOverview 大模型会话聊天相关的操作
 * @author xianyang 2025/11/15
 * @module
 */

import {OpenAI} from 'openai'
import retSchema from '../../daos/retSchema.js'
import conversationDac from '../../daos/core/dac/conversationDac.js'
import llmChannelDataSet, {getChannelMemory} from '../../conf/llmChannel.js'
import {resolveModelKey} from '../../conf/llmModel.js'
import tmplParse from 'json-templates'
import {llmRagSearch} from '../../grpc/clients/resourceRag.js'
import messageDac from '../../daos/core/dac/messageDac.js'
import {waitTime} from '../../tools/index.js'
import {getAnswerCache, saveAnswerCache} from './answerCache.js'
import {calcTextTokenCount, calcMessagesTokenCount, calcContextBudget, getTokenizerOptions, TOKENIZER_VERSION} from '../openai/util.js'
import {getMessages} from './message.js'
import {assemble, buildHistoryMessages, compactToBudget} from './memory/assemble.js'
import {mcpToolManager} from '../../mcp/index.js'
import {SkillChat} from '../../skill/skillChat.js'
import {collectRagSources} from './memory/sources.js'
import {captureTurn} from './memory/capture.js'
import {recallForPrompt, renderRecall} from './memory/recall.js'
import {buildMemoryTools, executeMemoryTool, isMemoryTool, memoryToolsEnabled} from './memory/tools.js'
import {buildOverflowTools, isOverflowTool, readOverflow, OVERFLOW_TOOL_NAME} from '../../tools/overflow.js'
import {buildCodeTools, isCodeTool, executeCodeTool, codeToolEnabled} from '../sandbox/codeTool.js'
import {peekSharedSandboxId} from '../sandbox/runner.js'
import {scheduleCheckpoint, flushCheckpoints} from './session/checkpoint.js'
import {truncateToolMessage} from '../../tools/truncate.js'
import {resolveMemory, safeWorkspaceId} from './memory/policy.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
/** 全局默认档位：文本走 relay_common_pro，带图走视觉档（可被频道 model 或请求 llmModel 覆盖） */
const defaultLlmConfigKey = process.env['LLM_DEFAULT_CONFIG_KEY'] || 'relay_common_pro'
const defaultLlmVLConfigKey = process.env['LLM_DEFAULT_VL_CONFIG_KEY'] || 'relay_qwen_vl_pro'
const defaultChannel = process.env['LLM_DEFAULT_CHANNEL'] || 'micro_common'
const defaultChannelGroup = 'none'

/** 工具结果进 trace 的截断快照：让历史回放的 ProcessPanel 有内容可看。
 *  完整留存另走 toolOverflows（预算裁剪时才存），这里只取前 4000 字符。 */
function clipTraceResult(content, limit = 4000) {
    const s = typeof content === 'string' ? content : JSON.stringify(content ?? '')
    return s.length > limit ? s.slice(0, limit) + '...[truncated]' : s
}

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
    const channel = options.channel || defaultChannel
    const channelGroup = options.channelGroup || defaultChannelGroup
    const llmChannelData = llmChannelDataSet[channel] || {}
    /**
     * 档位优先级：请求的 llmModel > 频道在 conf/llmChannel.js 里声明的 model > 本次默认
     * （带图默认走视觉档）；历史供应商名由 resolveModelKey 归一到对应档位。
     */
    const llmModel = resolveModelKey(options.llmModel || llmChannelData.model, defaultKey)
    const llmConfig = config.models[llmModel]
    /** 频道灰度与请求级逃生门在入口一次性合成，下游召回/采集/工具读同一份，避免各处漏判 */
    const channelMemory = resolveMemory(getChannelMemory(channel), options.memory)
    /** PR-16 ③：工作区分区（严格隔离）。schema 已挡非法形态，这里二次防御；缺省 null=全局分区=现状 */
    const memoryWorkspace = safeWorkspaceId(options?.memory?.workspaceId)
    const tokenizerOptions = getTokenizerOptions(llmConfig)
    /** 本仓 models 表未配 contextWindow 时预算取 Infinity（不裁剪，等于迁移前行为）；配了即自动生效 */
    const contextBudget = llmConfig?.contextWindow
        ? calcContextBudget(llmConfig, {slackTokens: config.context?.slackTokens})
        : Infinity
    let contextUsage = null

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

    /*协议 2 的客户端按事件名分派，因此默认下发工具结果，且 reset 不再携带兼容哨兵*/
    const clientProtocol = Number(options.protocol) >= 2 ? 2 : 1
    const emitToolResults = clientProtocol === 2 || !!options.streamToolResults
    let ragSources = []
    const toolCallTrace = []

    const emitMeta = (meta) => {
        if (clientProtocol === 2 && options.streamCallback) {
            options.streamCallback(JSON.stringify({type: 'meta', messageCode, conversationCode, protocol: 2, ...meta}), 'meta')
        }
    }

    const emitReset = () => {
        if (!options.streamCallback) {
            return
        }
        const payload = {role: 'tool', content: '回答内容重置', messageCode}
        if (clientProtocol === 1) {
            payload.tool_call_id = 'clear_answer_content'
        }
        options.streamCallback(JSON.stringify(payload), 'reset')
    }

    /*缓存命中与写入都不携带会话上下文，因此仅在该会话无历史时启用；
      批量/无状态场景可显式传 cacheIgnoreHistory 跳过该判定*/
    let cacheEligible = false
    if (options.cache && options.channelCacheKey) {
        cacheEligible = !!options.cacheIgnoreHistory || !(await messageDac.getTop(1, {conversationCode}))?.length
    }

    if (cacheEligible) {
        /*从缓存加载回答*/
        let cacheInfo = await getAnswerCache(query, channel, options.channelCacheKey, llmModel)
        if (cacheInfo) {
            emitMeta({cached: true, answerCacheCode: cacheInfo.answerCacheCode})
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

    const systemMessages = []
    const fixedMessages = []

    if (llmChannelData.sysPrompt) {
        let template = tmplParse(llmChannelData.sysPrompt)
        systemMessages.push({
            'role': 'system',
            'content': template(options.llmParams)
        })
    }
    if (llmChannelData.ragPrompt) {
        let segList = []
        /*增强检索属于可降级依赖，远端抖动时跳过注入而不是让整个聊天失败*/
        try {
            segList = await llmRagSearch(query, options.ragParams?.resCode, options.ragParams || {})
        } catch (e) {
            logger.error(`增强检索失败，本轮跳过 RAG: ${e.message}`)
        }
        if (segList?.length) {
            let template = tmplParse(llmChannelData.ragPrompt)
            fixedMessages.push({
                'role': 'user',
                'content': template({...options.ragParams, segs: segList.map(_ => _.content).join('\n\n')})
            })
            ragSources = collectRagSources(segList)
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
            /**
             * conversationCode 必须透传到 skill 执行层：沙箱执行按会话复用同一个沙箱，
             * 拿不到它就每次 skill 调用单独建箱，池会被吃满（dev 实测 429 POOL_CAPACITY_EXHAUSTED）。
             */
            context: {channel, channelGroup, llmModel, conversationCode}
        })

        skillContext = context

        if (prompt) {
            fixedMessages.push({
                'role': 'system',
                'content': prompt
            })
            logger.info(`已注入 ${skillContext.candidates.length} 个候选 Skills`)
        }
    } catch (error) {
        logger.warn(`Skills 初始化失败: ${error.message}`)
        // Skills 初始化失败不影响主流程
    }

    /** 召回注入放在 user 消息尾部而不是 system，保持系统前缀稳定以命中上游提示词缓存 */
    let recallStats = null
    let recalledItems = []
    /** 检查点续跑要复用首帧冻结的注入文本，续跑时重算会让前缀字节漂移 */
    let recallSnapshotText = ''
    let profileDocVersion = null
    if (channelMemory.recall) {
    const recallRet = await recallForPrompt({
        userCode: curUserInfo?.userCode,
        channel,
        workspaceId: memoryWorkspace,
        conversationCode,
        query,
            budget: channelMemory.recallTokens || config.memory?.recall?.tokens,
            tokenizerOptions,
        })
        recalledItems = recallRet.items || []
        recallStats = recallRet.stats
        recallSnapshotText = recallRet.text || ''
        profileDocVersion = recallRet.docVersion ?? null
        if (recallRet.text) {
            logger.info(`记忆召回注入 ${recalledItems.length} 条 / ${recallStats?.tokens ?? 0} tokens${recallRet.fromCache ? '（缓存）' : ''}`)
        }
    }

    const userText = recallStats?.kept ? `${query}\n\n${renderRecall(recalledItems)}` : query
    const currentMessage = options.inputs?.length
        ? {
            'role': 'user',
            'content': options.inputs.concat({
                type: 'text',
                text: userText
            })
        }
        : {'role': 'user', 'content': userText}

    const fixedCost = calcMessagesTokenCount([...systemMessages, ...fixedMessages, currentMessage], tokenizerOptions)
    const historyBudget = Number.isFinite(contextBudget) ? Math.max(0, contextBudget - fixedCost) : Infinity
    const historyRows = await getMessages({conversationCode}, 1, config.context?.historyMaxTurns || 10, {
        sort: {insertTime: -1},
        total: config.context?.historyMaxTurns || 10,
    })
    const {messages: historyMessages, dropped: historyDropped} = buildHistoryMessages(historyRows?.rows, {
        budget: historyBudget,
        tokenizerOptions,
        maxTurns: config.context?.historyMaxTurns || 10,
    })

    const assembled = assemble({
        systemMessages,
        fixedMessages,
        historyMessages,
        currentMessage,
        budget: contextBudget,
        tokenizerOptions,
    })
    messages = assembled.messages
    contextUsage = assembled.usage
    if (historyDropped.length || assembled.dropped.length) {
        logger.warn(`历史预算 ${historyBudget} / 总预算 ${contextBudget}，历史丢弃 ${historyDropped.length} 轮，装配再丢弃 ${assembled.dropped.length} 条`)
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

    // 合并所有可用工具（MCP工具 + Skill工具 + 记忆工具）
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

    /** 记忆工具让模型自己决定何时记住与回查，而不是把全部记忆无条件塞进上下文 */
    const useMemoryTools = memoryToolsEnabled({channelMemory, llmConfig})
    if (useMemoryTools) {
        allTools.push(...buildMemoryTools())
    }

    /** 沙箱未开放时连工具都不下发，模型也就不会去试"在我这边跑代码" */
    if (codeToolEnabled(config.sandboxConfig)) {
        allTools.push(...buildCodeTools())
    }

    /** 裁剪生效时才给取回工具，否则指针本来就是全文、没必要多一个可被误用的入口 */
    const useOverflowTools = Number(config.limits?.toolResultTokens) > 0
    if (useOverflowTools) {
        allTools.push(...buildOverflowTools())
    }

    // 如果有工具，添加到请求体
    if (allTools.length > 0) {
        createBody.tools = allTools
        createBody.tool_choice = 'auto' // 让模型自动选择何时使用工具
    }

    let answerContent = ''
    let answerReasoning = ''
    let answerList = []
    /** 被裁剪掉的工具全文，随消息留档，避免上下文爆炸同时不丢信息 */
    const toolOverflows = []

    // 最多迭代6次，用于处理工具调用
    let iterationCount = 0
    const maxIterations = 6

    /*中断也要留痕：已执行的工具副作用与部分回答需可追溯*/
    const persistTurn = async (progress) => {
        /** 落一条终态检查点（finish/abort），续跑与审计都以此为准 */
        scheduleCp(progress === 'abort' ? 'abort' : 'final', {
            messages: messages.map(m => ({...m})),
            answer: answerContent,
            toolState: {pendingCalls: [], completedCalls: toolCallTrace.map(t => t.id)},
        })
        await saveMessage(query, messageCode, messages, conversationCode, channel, channelGroup, llmModel, answerContent, answerReasoning, curUserInfo, {
            ...options,
            answerList,
            messageTokens: calcMessagesTokenCount(messages, tokenizerOptions),
            answerTokens: calcTextTokenCount(answerContent + answerReasoning, tokenizerOptions.tokenizer),
            tokenizerVersion: TOKENIZER_VERSION,
            tools: createBody.tools,
            toolChoice: createBody.tool_choice,
            iterationCount: iterationCount,
            skills: skillContext ? skillChat.getSkillStats(skillContext) : null,
            contextUsage,
            sources: ragSources,
            /** 含 result：已在 trace 侧截到 4000 字符，历史回放的 ProcessPanel 靠它显示返回内容 */
            toolCalls: toolCallTrace.map(t => ({id: t.id, name: t.name, result: t.result})),
            /** 全文留档到上限，超出部分只留量级说明，避免 message 文档无限膨胀 */
            toolOverflows: toolOverflows.map(o => ({
                ref: o.ref,
                tool: o.tool,
                originalTokens: o.originalTokens,
                keptTokens: o.keptTokens,
                chars: o.content.length,
                content: o.content.slice(0, config.limits?.overflowStoreChars || 200000),
                stored: o.content.length <= (config.limits?.overflowStoreChars || 200000),
            })),
            recallStats,
            progress,
        })
        /** 采集失败已在内部吞掉，不影响聊天主链路 */
    await captureTurn({
        curUserInfo,
        channel,
        workspaceId: memoryWorkspace,
        channelGroup,
            channelMemory,
            conversationCode,
            conversationType: conversationInfo?.conversationType,
            messageCode,
            query,
            answer: answerContent,
            answerReasoning,
            llmModel,
            options,
        })
        /** 收尾/中断路径把在途检查点落地，否则续跑现场缺失 */
        await flushCheckpoints()
    }

    /** 检查点公共上下文：会话、本轮消息与首帧冻结的记忆快照 */
    const checkpointBase = () => ({
        conversationCode,
        messageCode,
        userCode: curUserInfo?.userCode,
        channel,
        operator: {userCode: curUserInfo?.userCode, realName: curUserInfo?.realName},
        recallSnapshot: recallSnapshotText,
        recallAtomCodes: recalledItems.map(i => i.atomCode).filter(Boolean),
        profileDocVersion,
        /** PR-16 ②：绑定现场所属沙箱（只读窥视，绝不在这条路径上建箱/探活） */
        sandboxId: peekSharedSandboxId(conversationCode),
        usage: contextUsage,
        requestMeta: {
            model: llmModel,
            tools: (createBody.tools || []).map(t => t?.function?.name).filter(Boolean),
            toolChoice: createBody.tool_choice,
        },
    })

    /** 只登记不等待：检查点绝不能再关键路径上引入延迟 */
    const scheduleCp = (phase, extra) => scheduleCheckpoint({...checkpointBase(), phase, iteration: iterationCount, ...extra})

    emitMeta({
        cached: false,
        tools: (createBody.tools || []).map(t => t?.function?.name).filter(Boolean),
        toolChoice: createBody.tool_choice,
        contextBudget: contextUsage?.budget,
    })

    if (clientProtocol === 2 && ragSources.length && options.streamCallback) {
        options.streamCallback(JSON.stringify({sources: ragSources}), 'sources')
    }

    while (iterationCount < maxIterations) {
        if (options.signal?.aborted) {
            await persistTurn('abort')
            return 'aborted'
        }

        iterationCount++
        /*工具循环会持续往 messages 里塞结果，每轮请求前都要重新核对预算*/
        const loopTokens = compactToBudget(messages, contextBudget, {tokenizerOptions})
        if (contextUsage) {
            contextUsage = {...contextUsage, total: loopTokens, loopIteration: iterationCount}
        }
        logger.info(`=== 迭代 ${iterationCount} 开始, createBody.tools: ${JSON.stringify(createBody.tools?.map(t => t.function.name))}`)
        /** 请求前的字节级现场：续跑从这里恢复 */
        scheduleCp('preCreate', {
            messages: messages.map(m => ({...m})),
            toolState: {pendingCalls: [], completedCalls: toolCallTrace.map(t => t.id)},
        })
        //console.log(`createBody ${JSON.stringify(createBody)}`)
        let chatStream = await openai.chat.completions.create(createBody, {signal: options.signal})

        let toolCalls = []      // 用于收集工具调用
        let currentToolCall = null
        let receivedToolCall = false

        // 处理流式响应
        for await (const chunk of chatStream) {
            const choice = chunk.choices[0]
            if (!choice) continue

            const delta = choice.delta || {}

            // 处理普通内容和推理内容
            if (delta.content || delta.reasoning_content) {
                answerContent += delta.content || ''
                answerReasoning += delta.reasoning_content || ''
                options.streamCallback(JSON.stringify({role: 'assistant', ...delta, messageCode}))
            }

            // 检查是否有工具调用
            if (delta.tool_calls) {
                receivedToolCall = true
                for (const toolCallDelta of delta.tool_calls) {
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
            }
        }

        /** 响应后的现场：正文 + 本轮要求调用的工具，中断在此处发生时能原样重放 */
        scheduleCp('postCreate', {
            messages: messages.map(m => ({...m})),
            answer: answerContent,
            toolState: {
                pendingCalls: (receivedToolCall ? toolCalls : []).map(tc => ({id: tc.id, name: tc.function?.name})),
                completedCalls: toolCallTrace.map(t => t.id),
            },
        })

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
                    logger.info(`已添加工具到请求: ${selectedSkill.tools.map(t => t.function.name).join(', ')}`)
                }

                logger.info(`动态加载技能详情: ${selectedSkill.name}`)

                // 重置内容并重新请求
                answerContent && answerList.push(answerContent)
                answerContent = ''
                emitReset()
                continue
            }
        }

        // 如果收到了工具调用，处理它们
        if (receivedToolCall && toolCalls.length > 0) {
            // 过滤掉空的工具调用
            toolCalls = toolCalls.filter(tc => tc.id && tc.function.name)

            if (toolCalls.length > 0) {
                logger.info(`收到 ${toolCalls.length} 个工具调用: ${toolCalls.map(tc => tc.function.name).join(', ')}`)
                // 添加助手的消息到对话历史（包含工具调用请求）
                const assistantMessage = {
                    role: 'assistant',
                    content: null, // 工具调用时内容可能为空
                    tool_calls: toolCalls
                }
                messages.push(assistantMessage)

                /** 记忆、溢出取回、沙箱代码执行都要单独分派：否则会被当成 MCP 工具丢给 mcpToolManager 而找不到实现 */
                const memoryCalls = toolCalls.filter(tc => isMemoryTool(tc.function?.name))
                const overflowCalls = toolCalls.filter(tc => isOverflowTool(tc.function?.name))
                const codeCalls = toolCalls.filter(tc => isCodeTool(tc.function?.name))
                const otherCalls = toolCalls.filter(tc =>
                    !isMemoryTool(tc.function?.name) && !isOverflowTool(tc.function?.name) && !isCodeTool(tc.function?.name))
                const memoryToolContext = {
                    userCode: curUserInfo?.userCode, channel, workspaceId: memoryWorkspace,
                    conversationCode, messageCode,
                    curUserInfo, llmModel, llmParams: options.llmParams,
                }
                const memoryResults = await Promise.all(memoryCalls.map(async toolCall =>
                    executeMemoryTool({toolCall, context: memoryToolContext})))
                /**
                 * 取回被裁掉的工具结果：正文在本轮 toolOverflows 里，只在本轮有效（跨轮需重跑工具）。
                 * 自己判失败不抛错，避免一个翻页请求打断整条工具循环。
                 */
                const overflowResults = await Promise.all(overflowCalls.map(async toolCall => {
                    let args = {}
                    try {
                        args = JSON.parse(toolCall?.function?.arguments || '{}')
                    } catch { /* 按空参数处理，下面给出可读错误 */ }
                    const ret = readOverflow({
                        overflows: toolOverflows,
                        ref: args.ref || toolCall?.id,
                        offset: args.offset,
                        limit: args.limit,
                    })
                    return {
                        tool_call_id: toolCall?.id,
                        role: 'tool',
                        content: JSON.stringify(ret.success
                            ? {...ret.data, tool_note: `仅本轮可取回；还剩 ${ret.data.remaining} 字符未读`}
                            : ret),
                    }
                }))
                /** 模型生成的代码只进沙箱；内部异常一律转成工具结果，不打断工具循环 */
                const codeResults = await Promise.all(codeCalls.map(toolCall =>
                    executeCodeTool({
                        toolCall,
                        context: {conversationCode, userCode: curUserInfo?.userCode, channel},
                    })))

                // 执行工具调用（区分 MCP 工具和 Skill 工具）
                const otherResults = otherCalls.length
                    ? (skillContext
                        ? await skillChat.executeSkillToolCalls(otherCalls, skillContext)
                        : await mcpToolManager.executeToolCalls(channel, otherCalls))
                    : []
                const toolResults = [...memoryResults, ...overflowResults, ...codeResults, ...otherResults]

                /*工具结果只带 tool_call_id，前端无法据此显示调用了哪个工具，这里补上名称*/
                const nameById = {}
                toolCalls.forEach(tc => {
                    nameById[tc.id] = tc.function.name
                })

                // 将工具调用结果添加到消息历史中
                for (const toolResult of toolResults) {
                    const toolName = nameById[toolResult.tool_call_id] || null
                    /**
                     * 溢出取回的结果不再裁：它本身就是模型主动来要的片段，尺寸已由
                     * readOverflow 的 limit（上限 OVERFLOW_MAX_LIMIT）框住；再套一层通用预算
                     * 会把 JSON 本身裁断，翻页永远读不全（dev 实测：30 tokens 预算下
                     * `工具结果已裁剪 read_tool_result: 176 → 27 tokens`，模型连翻 5 轮拿不到内容）。
                     */
                    if (isOverflowTool(toolName)) {
                        messages.push(toolResult)
                        toolCallTrace.push({id: toolResult.tool_call_id, name: toolName, result: clipTraceResult(toolResult.content)})
                        continue
                    }
                    /**
                     * 工具/Skill 结果入上下文前必须按预算裁剪：一次网页抓取或 PDF 解析动辄数十万字符，
                     * 原样塞入会直接撑爆窗口。全文留在服务端，还给模型的是带裁剪说明与标识的片段。
                     */
                    const cut = await truncateToolMessage(toolResult, {
                        maxTokens: config.limits?.toolResultTokens,
                        headChars: config.limits?.toolResultHeadChars,
                        tailChars: config.limits?.toolResultTailChars,
                        tokenizer: tokenizerOptions.tokenizer,
                        ref: toolResult.tool_call_id,
                        hint: '全文已由服务端留存，需要时可要求助手按该标识进一步处理',
                    })
                    if (cut.truncated) {
                        toolOverflows.push({
                            ref: toolResult.tool_call_id,
                            tool: toolName,
                            originalTokens: cut.originalTokens,
                            keptTokens: cut.keptTokens,
                            content: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content ?? ''),
                        })
                        logger.info(`工具结果已裁剪 ${toolName || '-'}: ${cut.originalTokens} → ${cut.keptTokens} tokens`)
                    }
                    messages.push(cut.message)
                    toolCallTrace.push({id: toolResult.tool_call_id, name: toolName, result: clipTraceResult(toolResult.content)})

                    /*协议 1 的旧客户端会把 data.content 无条件拼进答案，因此仅在协议 2 或显式开启时下发*/
                    if (emitToolResults && options.streamCallback) {
                        options.streamCallback(JSON.stringify({
                            role: 'tool',
                            content: toolResult.content,
                            tool_call_id: toolResult.tool_call_id,
                            tool: toolName,
                            messageCode
                        }), 'tool_result')
                    }
                }

                // 重置内容变量为下一次迭代做准备
                answerContent && answerList.push(answerContent)
                answerContent = ''
                emitReset()
                /** 工具结果已并入消息，这里是可安全续跑的边界 */
                scheduleCp('postTools', {
                    messages: messages.map(m => ({...m})),
                    toolState: {pendingCalls: [], completedCalls: toolCallTrace.map(t => t.id)},
                })
                continue
            }
        }

        // 如果没有工具调用或者没有更多工具需要调用，退出循环
        break
    }

    if (options.signal?.aborted) {
        await persistTurn('abort')
        return 'aborted'
    }

    let answerTokens = calcTextTokenCount(answerContent + answerReasoning, tokenizerOptions.tokenizer)
    await persistTurn('finish')

    if (cacheEligible) {
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
    /**
     * PR-15：本轮沙箱成本。`totalPrice` 此前从未被写入过，现在第一次有数据来源。
     * 核算失败按 0 计 —— 成本是附属信息，不该因为它保存不了消息或打断回答。
     */
    let sandboxPrice = 0
    try {
        const {turnSandboxCost} = await import('../sandbox/usage.js')
        sandboxPrice = await turnSandboxCost({conversationCode})
    } catch { /* 忽略：保持 0 */ }
    await messageDac.add({
        messageCode,
        conversationCode,
        channel,
        channelGroup,
        llmModel,
        totalPrice: sandboxPrice,
        llmParams: options.llmParams,
        ragParams: options.ragParams,
        query,
        inputs: options.inputs || [],
        messages,
        answer: answerContent,
        progress: options.progress || 'finish',
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
            skills: options.skills,
            contextUsage: options.contextUsage,
            sources: options.sources,
            toolCalls: options.toolCalls,
            recallStats: options.recallStats,
            toolOverflows: options.toolOverflows,
        },
        messageTokens: options.messageTokens,
        answerTokens: options.answerTokens,
        tokenizerVersion: options.tokenizerVersion,
        attachments: options.attachments,
        answerAttachments: options.answerAttachments,
    })
}

