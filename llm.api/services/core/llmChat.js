/**
 * @fileOverview 大模型会话聊天相关的操作
 * @author xianyang 2025/11/15
 * @module
 */

import {OpenAI} from 'openai'
import retSchema from '../../daos/retSchema.js'
import conversationDac from '../../daos/core/dac/conversationDac.js'
import llmChannelDataSet, {getChannelMemory} from '../../conf/llmChannel.js'
import {pickModelKey} from '../../conf/llmModel.js'
import tmplParse from 'json-templates'
import {llmRagSearch} from '../../grpc/clients/resourceRag.js'
import messageDac from '../../daos/core/dac/messageDac.js'
/** §14 自有账本：模型用量按 run 落一行，看板与预算都从这张窄表出 */
import llmUsageDac from '../../daos/core/dac/llmUsageDac.js'
import {waitTime} from '../../tools/index.js'
/** run 级 traceId 的构造与传播（PR-0.3）：日志绑定、上游头、SSE 载荷共用一份真值 */
import {buildTrace, withTrace, traceHeaders} from '../../tools/traceContext.js'
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
/**
 * 停机三件套（接线自源仓 §25 v1.40–v1.43）：
 * isClosing 用来区分"用户按停止"与"发版拆连接"（HTTP 层两者都是 destroyed=true，无法分辨）；
 * attachArchive 让关闭序列能主动抢救，而不是等一个**可能永远不来**的断开事件
 * ——源仓实测：真实滚动里网关只拆客户端侧，应用侧连接一直活着，所以被动等必然落空。
 */
import {isClosing} from './session/shutdownState.js'
import {attachArchive, detachArchive} from './session/runRegistry.js'
import {CLOSE_ARCHIVE_WAIT_FOR_RUN_MS} from './session/shutdownPolicy.js'
import {truncateToolMessage} from '../../tools/truncate.js'
import {resolveMemory, safeWorkspaceId} from './memory/policy.js'
/**
 * 主循环的纯决策逻辑（协议协商、流式消费、tool_calls 聚合与分派、trace 截断、迭代退出方式）。
 * 抽到 `llmLoop.js` 是为了让它能被离线单测覆盖——`execChat` 此前零单测，而主循环要连续被改多轮。
 * 行为与抽取前逐字一致，包括"没有 index 的增量被丢弃"这类现状。
 */
import {
    resolveProtocol,
    pruneToolCalls,
    buildAssistantToolCallMessage,
    classifyToolCalls,
    buildToolNameIndex,
    clipTraceResult,
    drainAssistantStream,
    iterationDecision,
    loopExitReason,
    describeError,
    createBudgetMeter,
    deriveUsageMetrics,
    usageCallAlert,
    createEmptyUsage,
    addUsage,
    resolveMaxIterations,
    finalizationDecision,
    buildFinalizeBody,
    exhaustedFallback,
} from './llmLoop.js'
/** 过程分段（PR-B）：把被 reset 抹掉的中间正文留住 */
import {createSegmentLedger, SEGMENT_KINDS} from './segments.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
/** 全局默认档位由 conf/llmModel.js 读取（LLM_DEFAULT_CONFIG_KEY / LLM_DEFAULT_VL_CONFIG_KEY） */
const defaultChannel = process.env['LLM_DEFAULT_CHANNEL'] || 'micro_common'
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

    const channel = options.channel || defaultChannel
    const channelGroup = options.channelGroup || defaultChannelGroup
    const llmChannelData = llmChannelDataSet[channel] || {}
    /**
     * 选档：请求的 llmModel > 频道声明（带图只认 visionModel，文本认 model）> 全局默认；
     * 历史供应商名（qwenPlus 等）统一归一到「族×档」。
     */
    const llmModel = pickModelKey({
        llmModel: options.llmModel,
        channelConfig: llmChannelData,
        hasInputs: Boolean(options?.inputs?.length),
    })
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
    /**
     * 本 run 的起点（§14 账本的 latencyMs 基准）。
     * 放在函数入口而不是循环前：装配、RAG、记忆召回都算这一轮的成本。
     */
    const turnStart = Date.now()
    /**
     * 归属日（UTC yyyy-mm-dd）。定义紧挨 turnStart：
     * ① 开局落账与收尾落账共用同一个口径，两处各算一遍会在跨日界时把同一条 run 记进两个 day；
     * ② 位置必须早于使用点，否则 const 箭头函数踩 TDZ。
     */
    const usageDay = () => new Date().toISOString().slice(0, 10)

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
    /**
     * run 级 trace（PR-0.3）。**traceId 就是 messageCode**：不引入第三个标识符——
     * 同一个数存两处就会分叉（本项目在 usage 上真发生过），所以 traceId 只做传播，不新增存储列。
     */
    const trace = buildTrace({
        messageCode,
        conversationCode,
        userCode: curUserInfo?.userCode,
        channel,
        llmModel,
        reqId: options.reqId,
        inboundTraceId: options.inboundTraceId,
    })
    /** 本轮 run 级日志都走这个 child logger：没有 traceId 的日志等于没有日志 */
    const tlog = withTrace(logger, trace)
    let messages = []

    /*协议 2 的客户端按事件名分派，因此默认下发工具结果，且 reset 不再携带兼容哨兵*/
    const {protocol: clientProtocol, emitToolResults} = resolveProtocol(options)
    let ragSources = []
    const toolCallTrace = []

    const emitMeta = (meta) => {
        if (clientProtocol === 2 && options.streamCallback) {
            /** meta 里带 traceId（值就是 messageCode）：前端报错卡片可以显示"反馈请附这串号" */
            options.streamCallback(JSON.stringify({type: 'meta', messageCode, traceId: trace.traceId, conversationCode, protocol: 2, ...meta}), 'meta')
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
    /**
     * 开局就把这一轮写进账本（v1.33）。原来这一行只在 persistTurn 里写，
     * 于是被 SIGKILL 的 run 在 llmUsage 里也不存在——"发版丢了几轮"在数据上查不出来，
     * 而恢复扫描也没有对象：**没有行，就没有未终态**。
     *
     * 位置在缓存命中分支之后：命中缓存根本不发起模型调用，落 processing 只会制造假的中途行。
     * 失败不阻断主链路，但必须留 warn——账本缺行比多花几毛钱严重得多。
     */
    if (config.llmUsageLive?.enabled !== false) {
        try {
            await llmUsageDac.markStarted({
                messageCode,
                conversationCode,
                userCode: curUserInfo?.userCode || '',
                channel,
                llmModel,
                day: usageDay(),
            })
        } catch (e) {
            tlog.warn(`开局落账失败（不影响本轮回答，但这一轮将无法被恢复扫描发现）: ${String(e?.message || e).slice(0, 200)}`)
        }
    }

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
            tlog.error(`增强检索失败，本轮跳过 RAG: ${e.message}`)
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
            tlog.info(`已注入 ${skillContext.candidates.length} 个候选 Skills`)
        }
    } catch (error) {
        tlog.warn(`Skills 初始化失败: ${error.message}`)
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
            tlog.info(`记忆召回注入 ${recalledItems.length} 条 / ${recallStats?.tokens ?? 0} tokens${recallRet.fromCache ? '（缓存）' : ''}`)
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
        tlog.warn(`历史预算 ${historyBudget} / 总预算 ${contextBudget}，历史丢弃 ${historyDropped.length} 轮，装配再丢弃 ${assembled.dropped.length} 条`)
    }

    const openai = new OpenAI({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
        /** 上游请求头带 traceId：relay/网关侧的日志才能与我们这一侧对上 */
        defaultHeaders: traceHeaders(trace),
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
    /**
     * 停机抢救需要的实时正文与停止位（接线自源仓 §25 v1.40–v1.43）。
     *
     * 为什么必须有 `liveAnswer`：已累计的正文只存在于 `drainAssistantStream` 的局部变量里，
     * `answerContent` 要等 drain **返回**才累加；而抢救发生在它返回之前 ⇒
     * 不加这三个变量，兜底就只能写出 **0 字 abort**，而那条档一旦落下，
     * `persistTurn` 的幂等保护会把随后真正的 `finish` 永久挡在门外（源仓实测：客户端拿到 6,898 字，档案 0 字）。
     * 这里只做引用赋值（字符串不可变），不复制、不额外分配。
     */
    let liveAnswer = ''
    let liveReasoning = ''
    let liveAnswerMerged = false
    /** 停机抢救的本地停止位：由 `shouldStop` 在帧间检查，命中即带着已生成的正文早退 */
    let shutdownStopRequested = null
    /**
     * @description 把实时正文并进 answerContent（幂等：并过一次就不再并）
     * @returns {Boolean} 本次是否真的并了
     */
    const mergeLiveAnswer = () => {
        if (liveAnswerMerged || !liveAnswer) {
            return false
        }
        answerContent = liveAnswer
        answerReasoning = liveReasoning
        liveAnswerMerged = true
        return true
    }
    /**
     * @description 打断来源：只由"进程是否已在关闭"区分
     * @returns {String} process-lost（发版/关机拆连接）或 client-disconnect（用户或网络）
     */
    const interruptReason = () => (isClosing() ? 'process-lost' : 'client-disconnect')
    /** 被裁剪掉的工具全文，随消息留档，避免上下文爆炸同时不丢信息 */
    const toolOverflows = []

    /**
     * 过程分段账本（PR-B）：把"被 reset 抹掉的中间正文"留住。
     * 现状实测分布里 40% 的轮次存在被抹掉的内容，抽取前它们只在流里出现过一次，
     * 落库只剩最后一句或干脆空串，回放看不出这一轮到底查了什么、说过什么，评测也没有轨迹可算。
     */
    const segments = createSegmentLedger({
        textChars: config.limits?.segmentTextChars,
        maxSegments: config.limits?.segmentsMaxCount,
        totalChars: config.limits?.segmentsTotalChars,
    })
    /** 每轮的起始时刻，用于段耗时 */
    let roundStartedAt = Date.now()
    /**
     * 上下文预算测量器：迭代内只测新增消息。
     * `measureOne` 复用与全量同一个函数（`calcMessagesTokenCount` 传单条数组），
     * 因为它的实现是逐条 reduce ⇒ 总量严格等于各条之和，**增量与全量等价**（等价性由用例钉住）。
     * 越界时的安全网原样保留：真越界仍会 `compactToBudget`，压完必须 `invalidate()`。
     */
    const budgetMeter = createBudgetMeter({
        measureOne: (m) => calcMessagesTokenCount([m], tokenizerOptions),
    })

    // 最多迭代多少次：原为硬编码 6，现按 请求 > 频道 > 全局配置 > 6 解析
    let iterationCount = 0
    const maxIterations = resolveMaxIterations({
        requestValue: options.maxIterations,
        channelValue: llmChannelData?.maxIterations,
        configValue: config.limits?.maxIterations,
    })
    /**
     * 本 run 的 usage 累计与模型调用次数（§14 自有账本的原始数据）。
     * `modelCalls` 单独数，不复用 `iterationCount`：后者在收尾补落后也会 +1，
     * 而"每 run 调用次数"要的是真实打到上游的次数，两者今天恰好一致、将来未必一致。
     */
    let runUsage = createEmptyUsage()
    let modelCalls = 0

    /**
     * @description 计一次模型调用：**在发起请求处调，不是拿到 usage 之后**
     * @returns {Number} 累计调用次数
     * @description
     * 这个位置是成本账的命门：客户端中途断开时 usage 帧永远到不了，
     * 只在"拿到 usage"时计数，一次确实花了钱的调用就会记成 0 次 0 token。
     * 计数与量测分开后，`modelCalls` 记次数、`hasUsage:false` 记"这次没量到"，
     * 两者的差额正是"花了钱但量不出来"的量——那正是账本要暴露的东西。
     */
    const trackCall = () => {
        modelCalls++
        /**
         * 在途刷新：每次真正发起上游调用，就把"到目前为止发起了几次、花了多少"写回同一行。
         * 挂在 trackCall 定义内（而不是某个调用点）：本文件有两个发起点（主循环、无工具收尾），
         * 只挂一处就会让另一处被杀的 run 重新变隐形；挂在自增之后，也避开
         * "刷新早于计数"导致同一行里 modelCalls 比 attempts 少 1 的自相矛盾（主仓实测踩过）。
         *
         * 只写计数与 token：不写 progress（归收尾管，两处都写就互相覆盖，谁赢看时序），
         * 也不写 latencyMs（终态字段，在途写它就变成"最后心跳的时刻"，一个字段两义）。
         * 底座这条尚未接 PR-0.5 的 callUpstream，故暂不写 estPromptTokens；接线时补上 ——
         * 遗弃行的成本量级靠它，且**不能塞进 billablePromptTokens**（那列必须只表示上游实测值）。
         */
        if (config.llmUsageLive?.enabled !== false) {
            llmUsageDac.touchInflight({
                messageCode,
                modelCalls,
                promptTokens: runUsage.promptTokens,
                completionTokens: runUsage.completionTokens,
                totalTokens: runUsage.totalTokens,
                cachedTokens: runUsage.cachedTokens,
                reasoningTokens: runUsage.reasoningTokens,
                billablePromptTokens: Math.max(0, runUsage.promptTokens - runUsage.cachedTokens),
                hasUsage: runUsage.promptTokens > 0 || runUsage.completionTokens > 0,
            }).catch((e) => tlog.warn(`在途刷新账本失败: ${String(e?.message || e).slice(0, 160)}`))
        }
        return modelCalls
    }

    /**
     * @description 合并一次调用回传的 usage（只并量，不计数）
     * @param {Object} usage `drainAssistantStream` 返回的 usage
     * @returns {void}
     */
    const trackUsage = (usage) => {
        runUsage = addUsage(runUsage, usage)
    }

    /**
     * @description 账本归属日：UTC 的 yyyy-mm-dd，与 day 索引一致
     * @returns {String} yyyy-mm-dd
     */

    /**
     * @description 取当前这一轮的用量快照：派生指标 + 告警判定
     * @returns {{metrics: Object, alert: Object}} 见 `deriveUsageMetrics` 与 `usageCallAlert`
     * @description
     * 坚持**每次调用现算**，不读"稍后由收尾代码赋值"的外层变量：
     * 异常与中断路径根本不经过收尾代码，读外层变量会拿到初始值，
     * 结果同一轮里 `extInfo.usage.modelCalls` 是 0、账本行是 1，两个数字打架。
     */
    const usageSnapshot = () => ({
        metrics: deriveUsageMetrics(runUsage, modelCalls),
        alert: usageCallAlert({
            modelCalls,
            maxIterations,
            warnAt: config.limits?.runModelCallsWarn,
            hardAt: config.limits?.runModelCallsHardLimit,
        }),
    })

    /**
     * @description 上限打满时补一次"无工具收尾调用"：只带 messages 与提示，产出结论并照常流式下发
     * @returns {Promise<Boolean>} 是否拿到了非空正文
     */
    const runFinalizeCall = async () => {
        try {
            /** 预算重核与主循环每轮同口径：这一步也要求解，否则补落反而撑爆上下文 */
            compactToBudget(messages, contextBudget, {tokenizerOptions})
            /** 压缩会就地改写已有消息 ⇒ 增量测量结果作废，下一轮（若有）重新全量测 */
            budgetMeter.invalidate()
            const finalizeBody = buildFinalizeBody(createBody, messages)
            tlog.info(`无工具收尾调用开始: messages=${finalizeBody.messages.length}, maxIterations=${maxIterations}`)
            trackCall()
            const finalizeStream = await openai.chat.completions.create(finalizeBody, {signal: options.signal})
            const drained = await drainAssistantStream(finalizeStream, {
                onDelta: (delta, snapshot) => {
                    liveAnswer = snapshot?.content || liveAnswer
                    liveReasoning = snapshot?.reasoning || liveReasoning
                    options.streamCallback(JSON.stringify({role: 'assistant', ...delta, messageCode}))
                },
                /** 每帧之前问一次：客户端断开（aborted）或抢救下了停止位都要立刻停，别再花钱 */
                shouldStop: async () => (options.signal?.aborted ? 'aborted' : shutdownStopRequested),
            })
            /**
             * 早停就是终态：判据必须是**真值**（源仓就错过一次——写死 `=== 'aborted'`
             * 把抢救的 `'shutdown-archive'` 整个漏掉，于是 finish 被幂等挡住、档案停在 0 字 abort）。
             * `liveAnswerMerged` 为真时抢救已经并过正文，不能再累加一次（会变两份）。
             */
            if (drained.stopped) {
                if (!liveAnswerMerged) {
                    answerContent += drained.content
                    answerReasoning += drained.reasoning
                }
                trackUsage(drained.usage)
                finalizeInterrupted = true
                tlog.warn(`无工具收尾调用被打断: reason=${drained.stopped}, answerLen=${answerContent.length}`)
                return false
            }
            answerContent += drained.content
            answerReasoning += drained.reasoning
            trackUsage(drained.usage)
            iterationCount++
            /** 收尾调用本身也是一个阶段：它解释"为什么这一轮多花了一次调用" */
            segments.seal({
                kind: SEGMENT_KINDS.FINALIZE,
                text: drained.content,
                startedAt: roundStartedAt,
                now: Date.now(),
            })
            roundStartedAt = Date.now()
            tlog.info(`无工具收尾调用完成: 本轮answerLen=${drained.content.length}, finishReason=${drained.finishReason}`)
            return drained.content.length > 0
        } catch (e) {
            /** 收尾调用失败不该再拖垮整轮：落到 exhaustedFallback 的"部分内容 + 可读原因" */
            tlog.error(`无工具收尾调用失败: ${String(e?.message || e).slice(0, 300)}`)
            return false
        }
    }
    /** break 与"被上限掐断"是两种退出，抽取前无法区分（空答案缺陷因此不可观测）*/
    let loopBroke = false
    /** 无工具收尾调用是否被打断：打断要走 abort 落档，不能当成"补落成功" */
    let finalizeInterrupted = false
    /** persistTurn 要落这两个字段，必须在定义 persistTurn 之前就初始化（否则 abort 路径撞上 TDZ）*/
    let loopExit = 'unknown'
    let forcedFinal = false
    /** 幂等标记：异常路径与正常路径都调 persistTurn，同一轮只能落一条档 */
    let persisted = false

    /*中断也要留痕：已执行的工具副作用与部分回答需可追溯*/
    /**
     * @description 落库本轮（幂等：同一轮只落一次，异常路径不会造成重复行）
     * @param {String} progress 落库进度：finish/abort/error
     * @param {String} [errorMessage] 异常归因文本，写进 message.error 供历史与排障使用
     * @returns {Promise<void>}
     */
    const persistTurn = async (progress, errorMessage) => {
        if (persisted) {
            /** 重复落库会写出两条同 messageCode 的记录，历史与记忆采集都会翻倍 ⇒ 直接拒绝 */
            tlog.warn(`本轮已落库，忽略重复 persistTurn: progress=${progress}`)
            return
        }
        /** 现算快照：abort/error 路径不会走到收尾代码，读"稍后赋值"的外层变量会拿到过期初始值 */
        const snap = usageSnapshot()
        /**
         * 本地 tokenizer 量一次正文 token，两处共用：档案 `answerTokens` 与账本 `estCompletionTokens`。
         * 为什么账本要多这一列：usage 帧在流的**末尾**，客户端一断或容器一死就永远到不了 ⇒
         * 被切断的 run 在账本里 `completionTokens` 记 0，而实际生成了几千字 ⇒ 成本报表系统性低估损失。
         * 归列规矩（源仓 v1.38 定）：**估算归估算列，实测归实测列**，不许互相冒充。
         */
        const answerTokensNow = calcTextTokenCount(answerContent + answerReasoning, tokenizerOptions.tokenizer)
        /** 落一条终态检查点（finish/abort），续跑与审计都以此为准 */
        scheduleCp(progress === 'abort' ? 'abort' : 'final', {
            messages: messages.map(m => ({...m})),
            answer: answerContent,
            toolState: {pendingCalls: [], completedCalls: toolCallTrace.map(t => t.id)},
        })
        await saveMessage(query, messageCode, messages, conversationCode, channel, channelGroup, llmModel, answerContent, answerReasoning, curUserInfo, {
            ...options,
            answerList,
            /** 异常路径的归因（`describeError` 的 kind:message）；正常路径为 null */
            error: errorMessage || null,
            /** 把"循环怎么退出的"和"是否补过收尾调用"落进 extInfo，空答案从此可解释、可统计 */
            loopExit,
            forcedFinal,
            /**
             * 打断来源单独一列。`progress:'abort'` 必须同时表达"用户按停止"与"发版切连接"两件事，
             * 而这两件事在运维上是完全不同的问题（前者正常、后者是我们的损失）——
             * 压进一个字段就等于把 P-10 重新变回查不出来。
             */
            interruptedBy: progress === 'abort' ? interruptReason() : null,
            /** PR-B：过程分段。中间正文从此不再只存在于已经断开的那条 SSE 连接里 */
            segments: segments.list(),
            segmentSummary: segments.summary(),
            /** §14/G-6：本 run 的模型用量与调用次数（非缓存 token 为主指标） */
            usage: {...runUsage, ...snap.metrics, callAlert: snap.alert.level},
            messageTokens: calcMessagesTokenCount(messages, tokenizerOptions),
            answerTokens: answerTokensNow,
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
        /** 落库成功才算"已有档案"：放在 saveMessage 之后，这样 saveMessage 自己失败时异常路径还能再补一次 */
        persisted = true
        /**
         * §14 自有账本：一行一个 run 的模型用量。
         * 记账失败**绝不影响聊天主链路**（与沙箱成本核算、记忆采集同口径），
         * 但必须留 error 级日志——账本缺行比多花几毛钱严重得多。
         */
        try {
            await llmUsageDac.upsertByMessageCode({
                messageCode,
                conversationCode,
                userCode: curUserInfo?.userCode || '',
                channel,
                llmModel,
                day: usageDay(),
                modelCalls,
                promptTokens: runUsage.promptTokens,
                completionTokens: runUsage.completionTokens,
                totalTokens: runUsage.totalTokens,
                cachedTokens: runUsage.cachedTokens,
                billablePromptTokens: snap.metrics.billablePromptTokens,
                reasoningTokens: runUsage.reasoningTokens,
                hasUsage: snap.metrics.hasUsage,
                /** 估算输出（非上游回传）：被切断的 run 唯一的成本量级来源，与实测列分开存 */
                estCompletionTokens: answerTokensNow,
                callAlert: snap.alert.level,
                loopExit,
                progress,
                latencyMs: Date.now() - turnStart,
            })
        } catch (e) {
            tlog.error(`模型用量落账失败: messageCode=${messageCode}, ${String(e?.message || e).slice(0, 200)}`)
        }
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

    /**
     * 挂上停机抢救用的落档函数（两张表分开的理由见源仓 §25 v1.38：闸默认关着时
     * 登记表恒空，复用那张表会让"待抢救集合"在默认配置下永远是空的）。
     *
     * 两步、顺序不能反（源仓被真机读数纠正过两次）：
     *  1. 只下停止位 ⇒ run 在下一帧早退，由上面的 `drained.stopped` 分支带着正文自己落档；
     *  2. 等 CLOSE_ARCHIVE_WAIT_FOR_RUN_MS 仍未落档才兜底；**没正文就什么都不写**，
     *     留给回填扫描——写一条 0 字 abort 会挡住随后真正的 finish，比留着 processing 更坏。
     */
    attachArchive(messageCode, async () => {
        shutdownStopRequested = 'shutdown-archive'
        const tWait = Date.now()
        while (!persisted && Date.now() - tWait < CLOSE_ARCHIVE_WAIT_FOR_RUN_MS) {
            await new Promise(res => setTimeout(res, 50))
        }
        if (persisted) {
            tlog.info(`抢救只下了停止位，run 自己落档完成: 等待ms=${Date.now() - tWait}, answerLen=${answerContent.length}`)
            return
        }
        const mergedLive = mergeLiveAnswer()
        if (!(answerContent.length > 0 || answerReasoning.length > 0)) {
            tlog.warn(`抢救未落档: 等待 ${Date.now() - tWait}ms 后仍无正文，留给回填扫描处理（写 0 字 abort 会挡住真正的 finish）`)
            return
        }
        await persistTurn('abort', 'shutdown:process-lost')
        tlog.warn(`抢救兜底落档: 等待ms=${Date.now() - tWait}, 并入实时正文=${mergedLive}, answerLen=${answerContent.length}`)
    })

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

    /**
     * 主循环与其收尾（含退出方式判定、无工具收尾补落、落库与缓存）整体受 try/catch 保护。
     * 用整段包裹而不是逐处 try：需要兜住的抛点有 create、流消费、四类工具分派、技能检测、预算压缩等多处，
     * 逐个包必然会漏，而漏掉的那个恰好会让 persistTurn 被跳过。
     */
    try {
        while (iterationCount < maxIterations) {
            if (options.signal?.aborted) {
                await persistTurn('abort')
                return 'aborted'
            }

            iterationCount++
            roundStartedAt = Date.now()
            /*工具循环会持续往 messages 里塞结果，每轮请求前都要核对预算——但不再每轮全量重算*/
            let loopTokens = budgetMeter.check(messages)
            if (loopTokens > contextBudget) {
                /** 越界安全网：与原实现一致，压完丢弃增量结果，下一轮重新全量测 */
                compactToBudget(messages, contextBudget, {tokenizerOptions})
                budgetMeter.invalidate()
                loopTokens = budgetMeter.check(messages)
            }
            if (contextUsage) {
                contextUsage = {...contextUsage, total: loopTokens, loopIteration: iterationCount}
            }
            tlog.info(`=== 迭代 ${iterationCount} 开始, createBody.tools: ${JSON.stringify(createBody.tools?.map(t => t.function.name))}`)
            /** 请求前的字节级现场：续跑从这里恢复 */
            scheduleCp('preCreate', {
                messages: messages.map(m => ({...m})),
                toolState: {pendingCalls: [], completedCalls: toolCallTrace.map(t => t.id)},
            })
            //console.log(`createBody ${JSON.stringify(createBody)}`)
            trackCall()
            const chatStream = await openai.chat.completions.create(createBody, {signal: options.signal})

            /**
             * 整轮流式响应的消费与聚合在 `llmLoop.drainAssistantStream` 里：
             * 这样循环级测试可以注入假 stream（不依赖 OpenAI 客户端），且 SSE 下发时机与抽取前逐字一致。
             */
            const drained = await drainAssistantStream(chatStream, {
                onDelta: (delta, snapshot) => {
                    liveAnswer = snapshot?.content || liveAnswer
                    liveReasoning = snapshot?.reasoning || liveReasoning
                    options.streamCallback(JSON.stringify({role: 'assistant', ...delta, messageCode}))
                },
                shouldStop: async () => (options.signal?.aborted ? 'aborted' : shutdownStopRequested),
            })
            /**
             * 早停就是终态（判据写真值，理由见上面收尾调用处那条注释）。
             * 源仓实测：漏判这一次，用户拿到完整回答而档案是 0 字 abort。
             */
            if (drained.stopped) {
                if (!liveAnswerMerged) {
                    answerContent += drained.content
                    answerReasoning += drained.reasoning
                }
                /** 本 run 的用量：早停也要合并，否则账本会显示"跑了但没花钱" */
                trackUsage(drained.usage)
                if (drained.content) {
                    /** 与源仓同义：早停前那段正文要进过程分段，否则 PR-B 的段留存在这条路径上是空的 */
                    segments.seal({
                        kind: SEGMENT_KINDS.ANSWER,
                        text: drained.content,
                        startedAt: roundStartedAt,
                        now: Date.now(),
                    })
                }
                await persistTurn('abort')
                tlog.warn(`流被打断并就地落档: reason=${drained.stopped}, answerLen=${answerContent.length}, chunkCount=${drained.chunkCount}`)
                return 'aborted'
            }
            answerContent += drained.content
            answerReasoning += drained.reasoning
            /** 本 run 的用量：每一轮 create 合并一次（次数已在发起处计过） */
            trackUsage(drained.usage)
            let toolCalls = drained.toolCalls      // 用于收集工具调用
            let receivedToolCall = drained.receivedToolCall

            /** 响应后的现场：正文 + 本轮要求调用的工具，中断在此处发生时能原样重放 */
            scheduleCp('postCreate', {
                messages: messages.map(m => ({...m})),
                answer: answerContent,
                toolState: {
                    pendingCalls: (receivedToolCall ? toolCalls : []).map(tc => ({id: tc.id, name: tc.function?.name})),
                    completedCalls: toolCallTrace.map(t => t.id),
                },
            })

            /**
             * 本轮走向：skill-check / tool-round / final。
             * 抽取前是两条互斥的 if，这里换成一次判定，分支条件与顺序不变，抽出来是为了能离线穷举。
             */
            const decision = iterationDecision({
                receivedToolCall,
                rawToolCallCount: toolCalls.length,
                answerContent,
                skillContext,
            })

            // 检查大模型是否选择了某个技能（动态加载机制）
            if (decision === 'skill-check') {
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
                        tlog.info(`已添加工具到请求: ${selectedSkill.tools.map(t => t.function.name).join(', ')}`)
                    }

                    tlog.info(`动态加载技能详情: ${selectedSkill.name}`)

                    /** 段留存：这段正文马上要被 reset 抹掉了，先折进 segments（PR-B） */
                    segments.seal({
                        kind: SEGMENT_KINDS.SKILL_RELOAD,
                        text: answerContent,
                        startedAt: roundStartedAt,
                        now: Date.now(),
                        extra: selectedSkill.name,
                    })
                    // 重置内容并重新请求
                    answerContent && answerList.push(answerContent)
                    answerContent = ''
                    emitReset()
                    continue
                }
            }

            // 如果收到了工具调用，处理它们
            if (decision === 'tool-round') {
                // 过滤掉空的工具调用
                toolCalls = pruneToolCalls(toolCalls)

                if (toolCalls.length > 0) {
                    tlog.info(`收到 ${toolCalls.length} 个工具调用: ${toolCalls.map(tc => tc.function.name).join(', ')}`)
                    // 添加助手的消息到对话历史（包含工具调用请求）
                    messages.push(buildAssistantToolCallMessage(toolCalls))

                    /** 记忆、溢出取回、沙箱代码执行都要单独分派：否则会被当成 MCP 工具丢给 mcpToolManager 而找不到实现 */
                    const {memoryCalls, overflowCalls, codeCalls, otherCalls} =
                        classifyToolCalls(toolCalls, {isMemoryTool, isOverflowTool, isCodeTool})
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
                    const nameById = buildToolNameIndex(toolCalls)

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
                            tlog.info(`工具结果已裁剪 ${toolName || '-'}: ${cut.originalTokens} → ${cut.keptTokens} tokens`)
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

                    /** 段留存：本轮的半句正文到此为止，下一轮会被 reset 抹掉（PR-B 的主目标） */
                    segments.seal({
                        kind: SEGMENT_KINDS.TOOL_ROUND,
                        text: answerContent,
                        tools: toolCalls.map(tc => tc.function?.name).filter(Boolean),
                        startedAt: roundStartedAt,
                        now: Date.now(),
                    })
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
            loopBroke = true
            break
        }

        if (options.signal?.aborted) {
            await persistTurn('abort')
            return 'aborted'
        }

        /**
         * 退出方式只有在这里才可知（必须在 aborted 提前 return 之后判，否则一次正常打断会被报成异常退出）：
         * `exhausted` 表示循环是被 maxIterations 掐断的，而每一轮 `continue` 都执行过 reset
         * （`answerContent` 已清空），于是落库 answer 为空、progress 仍是 `finish`。
         */
        loopExit = loopExitReason({broke: loopBroke, iterationCount, maxIterations})
        if (loopExit !== 'break') {
            tlog.warn(`主循环非正常退出: reason=${loopExit}, iterationCount=${iterationCount}/${maxIterations}, 末段answerLen=${answerContent.length}, answerList段数=${answerList.length}`)
        }

        /**
         * **到顶不清空**：打满时补一次不带工具的收尾调用，让模型基于已取回的工具结果给出结论，
         * 而不是把已经花掉的钱和已经查到的信息丢成一条空白回答。
         */
        const fin = finalizationDecision({
            loopExit,
            answerContent,
            finalizeDisabled: config.limits?.maxIterationsFinalize === false,
        })
        if (fin.action === 'force-final') {
            forcedFinal = await runFinalizeCall()
        }

        /**
         * **空答案不得记 `finish`**：收尾调用也没拿到正文时，把被 reset 抹掉的分段保住（能救多少救多少）
         * 并附上可读原因，progress 记 `error`——不为此扩 `MessageProgressEnum`（会波及 schema 校验与前端分派）。
         */
        const fb = exhaustedFallback({loopExit, answerContent, answerList})
        if (fb.notice) {
            answerContent = fb.answer
            if (options.streamCallback) {
                options.streamCallback(JSON.stringify({role: 'assistant', content: fb.notice, messageCode}))
            }
            tlog.warn(`空答案兜底: reason=${fin.reason}, 保住部分正文=${fb.usedPartial}, progress=${fb.progress}, answerLen=${answerContent.length}`)
        }

        /**
         * 最终回答成段（全文已在 `message.answer`，这里只留字数与耗时）。
         * 即使补过收尾调用也照样要封这一段：`finalize` 段记的是"那次调用产出多少字"，
         * `answer` 段记的是"最终落库的答案是多少字"，两者在兜底路径上并不相等。
         * 重复计数的问题在账本的 `summary()` 里按 `ref==='answer'` 不计入来解决。
         */
        segments.seal({
            kind: SEGMENT_KINDS.ANSWER,
            text: answerContent,
            startedAt: roundStartedAt,
            now: Date.now(),
        })

        /**
         * §14 观测先行：出"每 run 模型调用次数"与"每 run token 数"。
         * 主指标是**非缓存 token**（`prompt - cached`，这部分全价），命中率只作旁证。
         * 告警口径是**严格大于上限**：打满但正常收尾不报（那是"活多"），超出上限才报（那才是"在打循环"）。
         */
        const tailSnap = usageSnapshot()
        if (tailSnap.alert.level !== 'ok') {
            tlog.warn(`模型调用次数告警: level=${tailSnap.alert.level}, modelCalls=${modelCalls}, warnAt=${tailSnap.alert.warnAt}, `
                + `maxIterations=${maxIterations}, loopExit=${loopExit}, conversationCode=${conversationCode}, messageCode=${messageCode}`)
        }
        if (!tailSnap.metrics.hasUsage) {
            /** 单独一条：账本没数据时，"0 token" 与"没读到 usage"是两种完全不同的故障 */
            tlog.warn(`本轮未取到 usage（上游未回传或帧序异常）: conversationCode=${conversationCode}, modelCalls=${modelCalls}`)
        }

        let answerTokens = calcTextTokenCount(answerContent + answerReasoning, tokenizerOptions.tokenizer)
        await persistTurn(fb.progress)

        /** 缓存只在真正完成时写：兜底文案进缓存等于把一次失败固化 90 天 */
        if (cacheEligible && fb.progress === 'finish') {
            /*缓存大模型回答*/
            /**
             * 缓存是附属能力：它失败不该让一整轮已经流完、已经落库的回答对外变成 error
             * （与 totalPrice 核算、记忆采集同口径）。
             */
            try {
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
            } catch (e) {
                tlog.warn(`写答案缓存失败（不影响本轮回答）: ${String(e?.message || e).slice(0, 200)}`)
            }
        }

        return 'done'
    } catch (e) {
        /**
         * 抽取前主循环那一段没有任何 try/catch：上游一抛（网络错误、relay 5xx、SDK 行为变更，
         * 或客户端打断以异常形态冒出来）就整段跳过 persistTurn，那一轮除了半截 SSE 什么都不留。
         * 现在**先落库再决定对外形态**：中断仍走 abort 语义（客户端断开不是故障，
         * 记成 error 会让监控里的错误率被用户行为污染）；真异常把原始错误继续抛给路由，由它下发 event:error。
         */
        const turnErr = describeError(e)
        tlog.error(`主循环异常: kind=${turnErr.kind}, status=${turnErr.status ?? '-'}, message=${turnErr.message.slice(0, 300)}`)
        const errProgress = turnErr.kind === 'abort' ? 'abort' : 'error'
        if (!persisted) {
            try {
                await persistTurn(errProgress, `${turnErr.kind}:${turnErr.message}`)
            } catch (e2) {
                /** 落库也失败时绝不掩盖原始异常：两份错误各留一次日志 */
                tlog.error(`异常路径落库失败: ${String(e2?.message || e2).slice(0, 200)}`)
            }
        }
        if (errProgress === 'abort') {
            /** 与既有中断路径同形：路由据此发 event:abort */
            return 'aborted'
        }
        throw e
    }
}


/**
 * @description 保存会话消息（本轮问答、执行过程与成本）
 * @param {String} query 用户问题
 * @param {String} messageCode 本轮消息标识
 * @param {Object[]} messages 发给模型的完整提示词
 * @param {String} conversationCode 会话标识
 * @param {String} channel 频道
 * @param {String} channelGroup 频道组
 * @param {String} llmModel 模型档位
 * @param {String} answerContent 回答正文
 * @param {String} answerReasoning 推理正文
 * @param {Object} curUserInfo 当前用户
 * @param {Object} options 执行过程与状态：progress、error、loopExit、forcedFinal、toolCalls 等
 * @returns {Promise<Object>} 落库结果
 */
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
        /** 异常归因（`kind:message`）：此前主循环抛错既不落库也没有这个字段，排障只能靠日志 */
        error: options.error || undefined,
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
            /** 循环退出方式（break/exhausted/…）与是否做过无工具收尾补落，空答案从此可解释、可统计 */
            loopExit: options.loopExit,
            forcedFinal: options.forcedFinal,
            /** PR-B：过程分段与它的体积摘要（丢过段、留存多少字） */
            segments: options.segments,
            segmentSummary: options.segmentSummary,
            /** §14/G-6：本 run 的模型用量与调用次数 */
            usage: options.usage,
            skills: options.skills,
            contextUsage: options.contextUsage,
            sources: options.sources,
            toolCalls: options.toolCalls,
            recallStats: options.recallStats,
            /**
             * 打断来源。注意它是 message.extInfo 里的字段，前端只读 `progress`（三端已能正确渲染 abort），
             * 这一列是给我们自己审计用的：事后要能分清当场落的档与补的档。
             */
            interruptedBy: options.interruptedBy,
            toolOverflows: options.toolOverflows,
        },
        messageTokens: options.messageTokens,
        answerTokens: options.answerTokens,
        tokenizerVersion: options.tokenizerVersion,
        attachments: options.attachments,
        answerAttachments: options.answerAttachments,
    })
}

