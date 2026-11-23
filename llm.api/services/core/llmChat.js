/**
 * @fileOverview 大模型会话聊天相关的操作
 * @author xianyang 2025/11/15
 * @module
 */

import {OpenAI} from 'openai'
import retSchema from '../../daos/retSchema.js'
import conversationDac from '../../daos/core/dac/conversationDac.js'
import {isInternalConversationCode} from '../../daos/core/policy/conversationVisibility.js'
import llmChannelDataSet, {getChannelMemory} from '../../conf/llmChannel.js'
import {pickModelKey, defaultModelKey, defaultVisionModelKey} from '../../conf/llmModel.js'
import tmplParse from 'json-templates'
import {llmRagSearch} from '../../grpc/clients/resourceRag.js'
import messageDac, {TERMINAL_PROGRESS} from '../../daos/core/dac/messageDac.js'
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
import {recallForPrompt, applyRecallToQuery} from './memory/recall.js'
import {buildMemoryTools, executeMemoryTool, isMemoryTool, memoryToolsEnabled} from './memory/tools.js'
import {buildOverflowTools, isOverflowTool, readOverflow, OVERFLOW_TOOL_NAME} from '../../tools/overflow.js'
import {buildCodeTools, isCodeTool, executeCodeTool, codeToolEnabled} from '../sandbox/codeTool.js'
import {classifyAction as gateClassifyAction, decideGate, SEED_GATE_RULES} from './session/execGate.js'
import {makeGateClassifyFn} from './session/gateClassifier.js'
import {buildPlanTools, isPlanTool, planToolEnabled, executePlanTool} from './session/planTool.js'
import {buildSaveArtifactTools, isSaveArtifactTool, saveArtifactToolEnabled, executeSaveArtifactTool} from './artifact/saveArtifactTool.js'
import {buildReadArtifactTools, isReadArtifactTool, executeReadArtifactTool} from './artifact/readArtifactTool.js'
import {buildReadAttachmentTools, isReadAttachmentTool, executeReadAttachmentTool} from './attachment/readAttachmentTool.js'
import {buildFeatureCatalogTools, isFeatureCatalogTool, executeFeatureCatalogSearch, FEATURE_SEARCH_TOOL_NAME} from './session/featureCatalogTool.js'
import {buildClarifyRequestTools, isClarifyRequestTool, parseClarifyRequest, CLARIFY_TOOL_NAME} from '../agent/clarifyBubble.js'
import {withRecitation, planForPersistence, seedPlanFromPrior} from './session/planAssembly.js'
import {decideCompletionSelfCheck, buildSelfCheckHint, interpretSelfCheckReply} from './session/planState.js'
import {peekSharedSandboxId} from '../sandbox/runner.js'
import {scheduleCheckpoint, flushCheckpoints} from './session/checkpoint.js'
/**
 * 停机状态与停机抢救表。
 * `isClosing` 用来区分"用户按停止"与"发版拆连接"（两者在 HTTP 层不可分辨）；
 * `attachArchive` 让关闭序列能主动把在途 run 落档，而不是等一个**可能永远不来**的断开事件。
 */
import {isClosing} from './session/shutdownState.js'
/** 抢救的等待预算：必须小于 `archiveAllInflight` 的单条超时，否则两边都没落成 */
import {CLOSE_ARCHIVE_WAIT_FOR_RUN_MS, PERSIST_VIA} from './session/shutdownPolicy.js'
import {attachArchive, detachArchive} from './session/runRegistry.js'
import {normalizeRegeneratedFrom, allowsAnswerCache, regeneratedFromForArchive} from './session/regeneration.js'
import {renderSteeringBlock, steerAckPayload} from './session/steerMailbox.js'
import {buildAskTools, isAskTool, askToolEnabled, awaitAskUser, answerSecret} from './session/askUserTool.js'
import {cacheIntentForArchive} from './session/cacheIntent.js'
import {decideThinking, thinkingForArchive} from './session/thinkingMode.js'
import {buildUsageCreditsFields} from './session/creditMeter.js'
import {extractTaskFields} from './session/taskAccounting.js'
import {truncateToolMessage} from '../../tools/truncate.js'
import {resolveMemory, safeWorkspaceId} from './memory/policy.js'
/**
 * 主循环的纯决策逻辑（协议协商、tool_calls 聚合与分派、trace 截断）。
 * 抽到 `llmLoop.js` 是为了让它能被离线单测覆盖——`execChat` 此前零单测（§2.10），
 * 而 PR-A/B/C/D/E 都要改它。行为与抽取前逐字一致，包括"没有 index 的增量被丢弃"这类现状。
 */
import {createSegmentLedger, SEGMENT_KINDS, needsCancelledSegment} from './segments.js'
import {
    resolveProtocol,
    pruneToolCalls,
    buildAssistantToolCallMessage,
    classifyToolCalls,
    buildToolNameIndex,
    buildToolArgsIndex,
    clipTraceArgs,
    buildToolCallTraceEntry,
    findTraceShapeGaps,
    drainAssistantStream,
    iterationDecision,
    loopExitReason,
    exitReasonForPersist,
    describeError,
    createBudgetMeter,
    createEmptyUsage,
    addUsage,
    deriveUsageMetrics,
    usageCallAlert,
    resolveMaxIterations,
    finalizationDecision,
    buildFinalizeBody,
    exhaustedFallback,
    withUpstreamRetry,
    canFallbackTo,
    parseRetryAfterMs,
    steerAction,
} from './llmLoop.js'
import {getBreaker, breakerKeyFor} from './upstreamBreaker.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
/**
 * 默认档位不再在本文件里写死字符串：与 `conf/llmModel.js` 用同一份定义（v1.27）。
 * 值不变（relay_common_pro / relay_qwen_vl_pro），改的是"谁说了算"——
 * 两处各写一遍时，改一处就会让"选中的模型"和"记录的模型"悄悄分家。
 */
const defaultLlmConfigKey = defaultModelKey
const defaultLlmVLConfigKey = defaultVisionModelKey
/**
 * 缺省频道与缺省分组。
 * **刻意 export**：路由层的补写档案（`session/errorTurnArchive.js`）也要算出同一个 `channel`，
 * 各写一份字面量的话，"哪天改缺省"就会变成只改一半的老问题（§2E-2 两份同值分家）。
 * 两侧一致性由 `test/services/core/errorTurnArchive.test.js` 里那条源码断言钉住。
 */
export const defaultChannel = 'xxzx_common'
export const defaultChannelGroup = 'none'

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

    /**
     * v1.27：档位选择走 `conf/llmModel.js` 的 `pickModelKey`（请求 > 频道声明 > 全局默认）。
     * 本项目频道目前**都没有声明** model/visionModel，所以这条与改造前的
     * `config.models[options.llmModel] || config.models[defaultKey]` 等价；
     * 差别只有一处、但是往好的方向：**非法的 `options.llmModel` 现在会被归一成真正使用的档位**，
     * 于是 `llmUsage.llmModel` 记的就是这一轮真正花钱的那个模型，而不是调用方传来的废值
     * （以前记废值、却用默认档跑，账本与实况分家）。
     */
    const llmModel = pickModelKey({
        llmModel: options.llmModel,
        channelConfig: llmChannelDataSet[options.channel || defaultChannel] || {},
        hasInputs: Boolean(options?.inputs?.length),
    })
    const llmConfig = config.models[llmModel]
    const channel = options.channel || defaultChannel
    const channelGroup = options.channelGroup || defaultChannelGroup
    const llmChannelData = llmChannelDataSet[channel] || {}
    /** 频道灰度与请求级逃生门在入口一次性合成，下游召回/采集/工具读同一份，避免各处漏判 */
    const channelMemory = resolveMemory(getChannelMemory(channel), options.memory)
    /** PR-16 ③：工作区分区（严格隔离）。schema 已挡非法形态，这里二次防御；缺省 null=全局分区=现状 */
    const memoryWorkspace = safeWorkspaceId(options?.memory?.workspaceId)
    const tokenizerOptions = getTokenizerOptions(llmConfig)
    const contextBudget = calcContextBudget(llmConfig, {slackTokens: config.context?.slackTokens})
    /**
     * 本 run 的起点（§14 账本的 latencyMs 基准）。
     * 必须放在函数入口而不是循环前：装配、RAG、记忆召回都算这一轮的成本。
     */
    const turnStart = Date.now()
    /**
     * 归属日（UTC yyyy-mm-dd）。**定义紧挨 turnStart**：
     * ① 开局落账与收尾落账必须共用同一个口径——两处各算一遍，跨日界的那条 run 就会被记进两个 day
     *    （账本的主聚合维度，与 D66"同一个数存两处就会分叉"是同一类问题）；
     * ② 位置必须早于使用点，否则 const 箭头函数会踩 TDZ。
     */
    const usageDay = () => new Date().toISOString().slice(0, 10)
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
            userCodes: [curUserInfo.userCode],
            /**
             * 建档点固化语义（conversationVisibility 的设计说明）：编排/任务的工作会话
             * （root:/agent: 前缀）在此打 internal 标 ⇒ 用户列表不被 1+N 条工作会话淹没。
             * 只有**创建者**知道前缀的意义，读取侧此后只看字段不看前缀。
             */
            internal: isInternalConversationCode(conversationCode)
        })
    }

    let messageCode = options.messageCode || tools.getUUID()
    /**
     * run 级 trace（PR-0.3）。**traceId 就是 messageCode**——不引入第三个标识符，
     * 因为同一个数存两处就会分叉（`extInfo.usage` 与 `llmUsage` 账本实测打过这个架，见 D66）。
     * 这里只做传播：日志绑定、上游请求头、SSE meta 载荷。
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
    /** 本轮所有 run 级日志都走这个 child logger：没有 traceId 的日志等于没有日志 */
    const tlog = withTrace(logger, trace)
    let messages = []

    /*协议 2 的客户端按事件名分派，因此默认下发工具结果，且 reset 不再携带兼容哨兵*/
    const {protocol: clientProtocol, emitToolResults, emitSegments} = resolveProtocol(options)
    let ragSources = []
    const toolCallTrace = []

    const emitMeta = (meta) => {
        /**
         * `>= 2` 而不是 `=== 2`：协议 3 是在 2 之上**追加**事件，不是替换。
         * 这里原来是严格相等，加档位 3 之后 `meta` 直接不发了——714 条单测全绿也没抓到，
         * 因为 llmChat 的发射顺序没有离线用例覆盖，是我按协议 3 实发一次逐帧看才发现的。
         * 同类问题由 `test/services/core/segmentEvents.test.js` 的源码守卫盯着（不许再出现 `=== 2`）。
         */
        if (clientProtocol >= 2 && options.streamCallback) {
            /**
             * meta 里带上 traceId（值就是 messageCode）：前端报错卡片可以显示"反馈请附这串号"，
             * 用户报障时我们拿到它就能同时命中日志、账本行与上游请求头。
             */
            /**
             * `protocol: clientProtocol` 而不是字面量 2：这里原来是硬编码的，
             * 于是协议 3 的流会在 `meta` 里自报 `protocol:2`。
             * 前端按 `meta.protocol` 选渲染分支的话，段事件**永远走不到那个分支**——
             * 而"后端在发、客户端被告知没有"正是最难查的那种不一致。
             */
            options.streamCallback(JSON.stringify({type: 'meta', messageCode, traceId: trace.traceId, conversationCode, protocol: clientProtocol, ...meta}), 'meta')
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
    /**
     * P3：重新生成的来源（判据在 `session/regeneration.js`）。
     * 必须在缓存分支**之前**算出来：缓存的键是 (query, channel, model)，
     * 重跑时三样都没变 ⇒ 不绕开缓存，"重新生成"会把同一条缓存答案再发一遍，
     * 用户看到按钮完成了，实际一个字都没变。
     */
    const regeneratedFrom = normalizeRegeneratedFrom(options.regeneratedFrom)
    let cacheEligible = false
    if (options.cache && options.channelCacheKey) {
        cacheEligible = !!options.cacheIgnoreHistory || !(await messageDac.getTop(1, {conversationCode}))?.length
    }
    /** 重生成一律不走缓存：这条不靠"前端记得传 cache:false" */
    cacheEligible = allowsAnswerCache({cacheEligible, regeneratedFrom})

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

    /**
     * **开局就把这一轮写进账本**（v1.33，P-10 的直接后果）。
     * 原来这一行只在 persistTurn 里写，于是被 SIGKILL 的 run 在 `llmUsage` 里也不存在——
     * "发版到底丢了几轮"在数据上查不出来。我一开始是拿探针日志数的，还数错了两回
     * （一次漏计最关键的对照，一次把 4 次真蒸发全划成仪器故障）。
     * 现在它是一行可查的记录：`progress:'processing'` + 谁、哪档、发起了几次。
     * PR-E 的恢复扫描也以此为数据源——**没有行就没有"未终态"**。
     *
     * 位置在缓存命中分支之后：命中缓存根本不发起模型调用，落 processing 只会制造假的中途行。
     * 失败不阻断主链路，但必须留 warn——账本缺行比多花几毛钱严重得多（与收尾落账同口径）。
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
        /**
         * PR-G 批二b：与账本同刻成对建**档案侧**的 processing 行（同一开关=同一个"开局记账"动作，
         * 拆两个开关只会造出"账本有行档案没行"的半态）。这把开关同时决定 2b 的全部行为：
         * 关掉 ⇒ 前端 ongoing 映射退回死分支（=批二a 之前的世界），R1 走老 add 支——**独立回退面**。
         * query/inputs 必带（提问气泡的渲染源）；失败只 warn——档案缺中途行的代价是
         * "刷新看不见进行中"，不是这一轮答不出来。
         */
        try {
            await messageDac.markStarted({
                messageCode,
                conversationCode,
                channel,
                channelGroup,
                llmModel,
                query,
                inputs: options.inputs || [],
                operator: {userCode: curUserInfo?.userCode || '', realName: curUserInfo?.realName || ''},
            })
        } catch (e) {
            tlog.warn(`开局建档失败（本轮刷新时不会显示"进行中"，R1 会按无档案行补记）: ${String(e?.message || e).slice(0, 200)}`)
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

    const userText = applyRecallToQuery(query, recalledItems)
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
    /**
     * PR-G 批二b：历史装配**只取终态行**。本 run 自己的 processing 中途行在 markStarted
     * 就已存在且按 insertTime 排最前——不过滤就会把"本轮的空回答"喂给模型当上一轮
     * （还与下面单独 append 的 currentMessage 重复）。complexFilter 是 assembleParams
     * 唯一的原生条件通道（getMessages 的 filter 键名有白名单映射），终态集用 dac 单源。
     */
    const historyRows = await getMessages({conversationCode, complexFilter: [{progress: {$in: TERMINAL_PROGRESS}}]}, 1, config.context?.historyMaxTurns || 10, {
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
        /**
         * `maxRetries`：**这里必须显式，不能留给 SDK 的默认值**。
         * SDK 默认 `maxRetries=2`，并且自己有一套重试判定（408/409/429/5xx 与连接错误都算可重试，
         * 见 `node_modules/openai/client.js` 的 `shouldRetry`）——也就是说**现网一直存在一层隐式的上游重试**：
         * 一次 `create()` 内部最多打 relay 三次，而我们的日志与账本只看到 1 次调用
         * （实测证据：`upstream-retry-probe` 场景 2/4，关掉我们这层之后 relay 仍收到 3 次请求）。
         *
         * 这层重试对我们是不可见的，也就**不受我们的次数上限、退避与换档策略管**：
         * 我们的 `markFirstByte` 拦不住它（它在 SDK 内部、首字节之前），于是两层相乘最坏是
         * `maxAttempts × 3` 次真实请求（实测 3×3=9，见场景 5）。
         *
         * 所以策略只能有一处说话：
         * - 我们的重试**开着** ⇒ SDK 侧置 0，由 `withUpstreamRetry` 一个人决定重试与换档；
         * - 我们的重试**关着** ⇒ 保持 SDK 默认（`undefined`），与改造前逐字一致，
         *   不借这个 PR 顺手改变现网的重试语义。
         */
        maxRetries: (config.upstreamRetry && config.upstreamRetry.enabled === true) ? 0 : undefined,
        /**
         * 上游请求头带 traceId：relay/网关侧的日志才能和我们这一侧对上——
         * 现网最常见的"超时但 200"、"缓存折扣对不上"这类问题，缺的就是这一根线。
         */
        defaultHeaders: traceHeaders(trace),
    })

    // 检查当前频道是否启用了MCP工具
    const hasMcpTools = await mcpToolManager.hasTools(channel)
    /**
     * 深度思考的决策（D44：**不得由 bug 默认决定，且必须留痕**）。
     * 2026-11-13 实测到的是三层默认值叠出来的静默关闭：
     * ① 本行原来的 `options.enableThinking && llmConfig.enableThinking` 把请求侧排在前面短路；
     * ② dev 没有任何 `*_enableThinking` 变量 ⇒ 档位侧恒空；
     * ③ 三端前端硬编码 `enableThinking: 0` ⇒ 运维就算配好档位，聊天界面仍然关着。
     * 判据与真值语义都在 `session/thinkingMode.js`（那里有与改造前那句的逐值等价用例），
     * 这里只负责用它，并把结果留给 `persistTurn` 落档。
     */
    const thinkingDecision = decideThinking({
        requested: options.enableThinking,
        profile: llmConfig.enableThinking,
        modelKey: llmModel,
    })
    let createBody = {
        model: llmConfig.model,
        messages,
        max_tokens: llmConfig.maxTokens,
        temperature: llmConfig.temperature,
        stream: true, // 启用流式输出
        // 深度思考：参数只能由 thinkingMode 这一处给，别在这里再写一个 `&&`
        ...thinkingDecision.params,
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

    /**
     * PR-M：计划工具默认关（`plan_enabled`）。开 ⇒ 下发 `update_plan`，模型可把计划外置成结构化状态；
     * 关 ⇒ 这里一行都不做、`planOn=false` 让后面 recitation 也原路返回，主循环与加它之前逐字一致。
     */
    const planCfg = config.planConfig || {}
    const planOn = planToolEnabled(planCfg)
    if (planOn) {
        allTools.push(...buildPlanTools())
    }
    /**
     * PR-H2：save_artifact 默认关（`artifact_enabled`，且要求 `sandbox_enabled`——没有沙箱它无意义）。
     * 关 ⇒ 这里一行都不做；开 ⇒ 字节由服务端经 execd 自取（模型只申报路径，见 saveArtifactTool 头注释）。
     */
    const artifactCfg = config.artifactConfig || {}
    const artifactOn = saveArtifactToolEnabled(artifactCfg, config.sandboxConfig || {})
    if (artifactOn) {
        allTools.push(...buildSaveArtifactTools())
        /** §9.5 line 813 配对件：能存还要能取回，"压缩≠丢信息"才成立 */
        allTools.push(...buildReadArtifactTools())
    }
    /**
     * PR-E：ask_user 默认关（`control_askEnabled`）。双闸：配置开 **且** 本 run 有答复路由器
     * （root.js 只在同一条配置下建 router）——只开一侧时模型根本看不见这个工具，
     * "能问不能答=挂死 run"的错配面从注册点就关死。
     */
    const askCfg = config.controlConfig || {}
    const askOn = askToolEnabled(askCfg) && !!options.answerRouter
    if (askOn) {
        allTools.push(...buildAskTools())
    }
    /**
     * B-1（附件授权前门，默认关）：read_attachment 只随**任务上下文**注册——
     * 普通轮没有授权面（root 快照在谁那里都没有定义），与其运行时拒话，不如不给模型这个选项。
     * 关/无 taskContext ⇒ 这里一行都不做，工具清单与现网逐字一致。
     */
    const attachCfg = config.limits?.taskAttachment || {}
    const attachOn = attachCfg.enabled === true && !!options.taskContext?.rootCode
    if (attachOn) {
        allTools.push(...buildReadAttachmentTools())
    }
    /**
     * §7-1 澄清冒泡（默认关）：request_clarification 只给**编排 child**——注册三闸：
     * flag 开、taskContext.agentRole==='child'、sink 由 handler 给（agentChat 在场）。
     * 普通轮/追问轮/综合轮都不给：它们的"问用户"有正当通道（直接回正文问），不需要冒泡。
     * 它与 ask_user 是两件事：ask_user 挂起等答复（child 禁挂），本工具恒立即 ack（申报不等待）。
     */
    const clarifyCfg = config.agentTask?.clarifyBubble || {}
    const clarifyOn = clarifyCfg.enabled === true && options.taskContext?.agentRole === 'child' && typeof options.clarifySink === 'function'
    if (clarifyOn) {
        allTools.push(...buildClarifyRequestTools())
    }
    /**
     * 功能目录检索（platform-feature-map Phase 1 刀2，缺省全关）：双闸——featureCatalog.enabled
     * 且当前频道在 enabledChannels（W9：频道名是部署事实，判据不硬编）。关时这里一行不做，
     * 工具清单与现网逐字一致（conversationTaskQueue/clarifyBubble 同款分叉纪律）。
     */
    const fcCfg = config.featureCatalog || {}
    const featureCatalogOn = fcCfg.enabled === true && Array.isArray(fcCfg.enabledChannels) && fcCfg.enabledChannels.includes(channel)
    if (featureCatalogOn) {
        allTools.push(...buildFeatureCatalogTools())
    }
    /**
     * 本轮计划：初值从上一轮档案 seed（跨轮 recitation），之后由 update_plan 整份替换。
     * recitation 与落档都读它。null = 既没有上一轮计划、本轮也还没调用 update_plan。
     */
    let currentPlan = null
    /**
     * PR-M B1 跨轮 seed：只在开了计划时才读上一轮档案（关着连这次查询都不发 ⇒ 默认关对现网零成本）。
     * seed 失败绝不阻断这一轮——没有上一轮计划可续，就当本轮从零开始，与"从没开过计划"同一条路径。
     */
    if (planOn) {
        try {
            currentPlan = seedPlanFromPrior(await messageDac.getLatestExtInfoPlan(conversationCode))
        } catch (e) {
            tlog.warn(`跨轮计划 seed 失败，按无历史计划继续: ${String(e?.message || e).slice(0, 160)}`)
        }
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
    /** PR-D commit 2：本轮实际注入过的插话（含注入时刻）。没注入过 ⇒ 落档 null 而不是空壳数组（同 plan 的裁定） */
    const steeringsArchive = []
    /**
     * PR-I 执行门（D18 四层门；判据与编排纯件在 `session/execGate.js`）。
     * gate_enabled 默认关 ⇒ 关着时一次都不咨询（与 plan/steer/ask 同款"关着不可见"，零成本零延迟）；
     * enforce 关而 enabled 开 ⇒ 观察模式（裁决照跑、全档落 extInfo.gate，但一个都不拦）。
     * gateLedger：decisions=档案面（界 40）；verdicts=保险丝尾计数；approvals=人工裁决计数。
     */
    const gateCfg = config.gateConfig || {}
    const gateOn = gateCfg.enabled === true
    const gateEnforce = gateCfg.enforce === true
    const gateLedger = {decisions: [], verdicts: [], approvals: 0}
    let gateClassifyFn = null

    /**
     * 过程分段账本（PR-B）：把"被 reset 抹掉的中间正文"留住。
     * dev 实测 `answerList` 段数分布 ⇒ **230/574（40%）的轮次存在被抹掉的内容**，
     * 抽取前这些内容只在流里出现过一次，落库只剩最后一句或干脆空串，回放与评测都没有轨迹。
     */
    const segments = createSegmentLedger({
        textChars: config.limits?.segmentTextChars,
        maxSegments: config.limits?.segmentsMaxCount,
        totalChars: config.limits?.segmentsTotalChars,
        /**
         * 协议 3：段的**边界**下发给客户端（`segment_start`/`segment_end`）。
         * 现在成对出现在封段时刻，而不是开段时刻——这是刻意的：
         * 一轮最终是 tool-round / skill-reload / finalize / answer，**在开段那一刻是不可知的**，
         * 若那时就发 start，载荷里的 `kind`/`title` 只能是猜的，
         * 于是前端会拿到一张标题"调用工具"、结尾却是 finalize 度量的卡——
         * 那正是 D63 ① 要禁止的"让前端反推阶段"，只是换了个位置发生。
         * 实时开段要等"开段时刻能给出什么 kind"有明确结论之后再做。
         */
        events: emitSegments,
        onEvent: (event, payload) => {
            try {
                options.streamCallback(JSON.stringify(payload), event)
            } catch (e) {
                /** 下发失败不能把整轮打挂：段的权威副本仍在 extInfo.segments 里，回放看得见 */
                tlog.warn(`段事件下发失败（不影响落库）: ${event} ${e.message}`)
            }
        },
    })
    /** 每轮的起始时刻，用于段耗时 */
    let roundStartedAt = Date.now()
    /**
     * 上下文预算测量器（PR-K1）：迭代内只测新增消息。
     * `measureOne` 用与全量同一个函数（`calcMessagesTokenCount` 传单条数组），
     * 这样"逐条相加"与"整体一次算"用的是同一套口径，不会有第二条估算路径偷偷漂移。
     */
    const budgetMeter = createBudgetMeter({
        measureOne: (m) => calcMessagesTokenCount([m], tokenizerOptions),
    })

    // 最多迭代多少次：原为硬编码 6，现按 请求 > 频道 > 全局配置 > 6 解析（§2E-3 修法第 3 条）
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
     * @description 计一次模型调用：**在发起请求之前调，不是拿到结果之后**
     * @returns {Number} 累计调用次数
     * @description
     * 这个位置是成本账的命门。客户端中途断开时 usage 帧永远到不了，
     * 如果只在收到 usage 时计数，一次"打了但被打断"的调用就会记成 0 次 0 token
     * ——而它确实花了钱。实测：`abort` 场景下打断在 2.5s，drain 未完成，旧计数点给出 `modelCalls:0`。
     */
    const trackCall = () => {
        modelCalls++
        return modelCalls
    }

    /**
     * @description 合并一次调用回传的 usage（只并 token，不计数）
     * @param {Object} usage `drainAssistantStream` 返回的 usage
     * @returns {Number} 当前的累计调用次数
     */
    const trackUsage = (usage) => {
        runUsage = addUsage(runUsage, usage)
        return modelCalls
    }

    /* ---------- PR-0.5：上游调用的重试与换档 ---------- */

    /**
     * 重试配置。**默认 `enabled: false`** ⇒ 不配就与改造前逐字一致（一次失败直接抛给上层）。
     * 打开之后也只覆盖"首字节前的失败"，理由见 `upstreamRetryDecision` 规则 1。
     */
    const upstreamCfg = config.upstreamRetry || {}
    /** 备选档位：配了不存在的 key 等于没配，但不能让主流程因此崩掉 */
    const fallbackCfg = upstreamCfg.fallbackModel ? (config.models?.[upstreamCfg.fallbackModel] || null) : null
    if (upstreamCfg.fallbackModel && !fallbackCfg) {
        tlog.warn(`upstreamRetry.fallbackModel=${upstreamCfg.fallbackModel} 不是有效档位 key，换档功能关闭`)
    }
    /**
     * 上游熔断（§2B/PR-0.5 剩余项③）。**进程级单例**：它衡量的是"这个出口现在死没死"，
     * 属于服务健康而不是某一轮的状态 ⇒ 观测只能走 `llm.logger`，
     * 不能绑在 `tlog` 上——单例会把第一次调用时的那个 run 日志器一直握着，
     * 后面的熔断事件就全写进了一条早已结束的 trace。
     */
    const upstreamBreaker = getBreaker({
        cfg: config.upstreamBreaker || {},
        log: (e) => logger.warn(`upstreamBreaker ${JSON.stringify(e)}`),
    })
    /** 出口键：取**当次真正使用的那一档**的 baseURL。12 档同出口时它们收敛成同一个键（D39 要的就是这个） */
    const breakerKeyOf = ({usingFallback}) => breakerKeyFor({
        baseURL: (usingFallback ? fallbackCfg : llmConfig)?.baseURL,
        modelKey: usingFallback ? upstreamCfg.fallbackModel : llmConfig.key,
    })
    if (upstreamBreaker.config.enabled) {
        tlog.info(`上游熔断已启用: threshold=${upstreamBreaker.config.failureThreshold} openMs=${upstreamBreaker.config.openMs}`
            + (upstreamBreaker.config.notes?.length ? ` 参数归一提示=${JSON.stringify(upstreamBreaker.config.notes)}` : ''))
    }
    /** 本轮换档过程的留痕（进 message.extInfo 与 llmUsage，供看板区分"慢"与"抖"） */
    const upstreamStats = {attempts: 0, retried: 0, fallbackFrom: '', fallbackTo: '', lastReason: ''}
    /** 换过档之后，账本与 SSE meta 里记的都必须是**真正回答了这个字的那个档位**（v1.27 同一条原则） */
    let llmModelUsed = llmModel
    /** 备选档位要单独建 client：baseURL 与 apiKey 都可能不同 */
    const fallbackClients = new Map()

    /**
     * @description 打一次上游：创建流 + 消费到结束，期间跟踪"有没有吐过字"
     * @param {Object} params 参数
     * @param {Object} params.body 请求体
     * @param {Function} params.onDelta 每条增量回调
     * @param {Number} [params.promptTokens] 本次请求的 prompt token 估算（换档可行性要用）
     * @param {String} params.tag 日志标记
     * @returns {Promise<Object>} `drainAssistantStream` 的结果
     */
    /**
     * 实时正文三件套。存在的原因是 2026-11-10 那次真实滚动验收抓到的硬伤：
     * 抢救落档时档案写成了 **0 字 abort**，而客户端其实收到了 6,898 字。
     * 根因不在"要不要落档"，在**正文在哪**：已累计的正文只存在于 `drainAssistantStream` 的局部变量里，
     * `answerContent` 要等 drain **返回**才累加，而抢救恰恰发生在它返回之前。
     *
     * `onDelta` 的第二参数就是 drain 的 snapshot（`content` 是它的累计值），
     * 这里只做**引用赋值**（字符串不可变），不复制、不额外分配。
     */
    let liveAnswer = ''
    let liveReasoning = ''
    let liveAnswerMerged = false
    /**
     * @description 把实时正文并进 `answerContent`（幂等：并过一次就不再并）
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

    const callUpstream = async ({body, onDelta, promptTokens = 0, tag}) => {
        const ret = await withUpstreamRetry({
            cfg: {...upstreamCfg, fallbackModel: fallbackCfg ? upstreamCfg.fallbackModel : ''},
            /** 熔断：默认关（`upstreamBreaker_enabled` 不为 true 时 `allow()` 一律放行，行为与改造前一致） */
            breaker: upstreamBreaker,
            breakerKeyOf,
            invoke: async ({usingFallback, markFirstByte}) => {
                const cfg = usingFallback ? fallbackCfg : llmConfig
                /**
                 * 换档时 `model` 与 `max_tokens` 必须一起换：
                 * 只换 `model` 会拿着主档的 60000 输出上限去打一个 16384 窗口的备选档，
                 * 那不是重试是必然失败。
                 */
                const sendBody = usingFallback
                    ? {...body, model: cfg.model, max_tokens: Math.min(Number(body.max_tokens) || cfg.maxTokens, cfg.maxTokens)}
                    : body
                upstreamStats.attempts++
                if (usingFallback) {
                    upstreamStats.fallbackTo = cfg.key
                }
                if (upstreamStats.attempts > 1) {
                    upstreamStats.retried++
                }
                trackCall()
                /**
                 * 在途刷新：把"到目前为止真的发起了几次、花了多少"写回账本行。
                 * **只写计数与 token，不写 progress**（dac 的 touchInflight 里还会再挡一道）：
                 * 进度归收尾管，两处都能写就会互相覆盖，谁赢取决于时序
                 * ——那是 §2E-2"两份同值分家"的复发形状。
                 * 不 await：刷新账本不该拖住一次生成；但失败要看得见。
                 * 不写 latencyMs：那是终态字段（整轮墙钟）。在途写它，一个字段就变成两义——
                 * 实测留下的行是 latencyMs=180 而这条流实际活了 12.2s，谁拿它算时长都会短一个量级。
                 *
                 * **这行能读出什么、读不出什么要写死在注释里**（免得下一个人又去声明它）：
                 * 能读出 `insertTime`=开局时刻、`updateTime`=最后一次心跳、以及已发起的调用数与已花的 token；
                 * **读不出这轮死了多久**——硬杀不会补写最后一笔，所以它没有"结束时间"。
                 * 想拿到在途时长就得周期性心跳（每 N 秒一笔写），那是"写放大 vs 可观测"的另一个决定，
                 * 现在先不做：`listAbandoned` 要的是"这轮被遗弃了、花了多少"，不是"它精确活了多久"。
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
                        /** 估算输入 token：给被硬杀的 run 留一个量级（真值仍由收尾写 billablePromptTokens） */
                        estPromptTokens: promptTokens || 0,
                        upstreamAttempts: upstreamStats.attempts,
                        upstreamRetried: upstreamStats.retried,
                        fallbackFrom: upstreamStats.fallbackFrom,
                        fallbackTo: upstreamStats.fallbackTo,
                        // M6：credits 与 tokens 同刻同源（helper 单一定义，见 buildUsageCreditsFields 处注释）
                        ...buildUsageCreditsFields({
                            promptTokens: runUsage.promptTokens, completionTokens: runUsage.completionTokens,
                            model: cfg, weights: config.credits?.weights,
                        }),
                        // §5-4：任务关联三列（白名单抽取；普通聊天不带=键缺席，不写空串）
                        ...extractTaskFields({taskContext: options.taskContext}),
                    }).catch((e) => tlog.warn(`在途刷新账本失败: ${String(e?.message || e).slice(0, 160)}`))
                }
                let client = openai
                if (usingFallback) {
                    const ck = `${cfg.baseURL}|${cfg.apiKey}`
                    if (!fallbackClients.has(ck)) {
                        /** `maxRetries` 与主 client 同口径：开着我们的重试就不让 SDK 再叠一层 */
                        const sdkRetries = upstreamCfg.enabled === true ? 0 : undefined
                        fallbackClients.set(ck, new OpenAI({
                            apiKey: cfg.apiKey, baseURL: cfg.baseURL,
                            defaultHeaders: traceHeaders(trace), maxRetries: sdkRetries,
                        }))
                    }
                    client = fallbackClients.get(ck)
                }
                const stream = await client.chat.completions.create(sendBody, {signal: options.signal})
                return await drainAssistantStream(stream, {
                    onDelta: (delta, snapshot) => {
                        /** 吐过字就打上标记：这一步决定了"这次失败还能不能安全重来" */
                        markFirstByte()
                        /**
                         * 记下 drain 的实时累计值（引用，不复制）。
                         * 抢救路径要靠它——那时 `answerContent` 还是空的。
                         */
                        liveAnswer = snapshot?.content || liveAnswer
                        liveReasoning = snapshot?.reasoning || liveReasoning
                        onDelta(delta)
                    },
                    /**
                     * 每帧问一次"还要不要继续"。
                     * 没有这一条时，`options.signal.aborted` 只在 drain **返回之后**才被检查
                     * （`:888`、`:1138`），于是客户端断开后生成会一路跑到底：
                     * 实测断开之后又送出 45 秒 / 10,772 字，而档案一行没写、账本停在 `processing`。
                     * 早停之后 `:1138` 的那条路径就能立刻执行，把已有正文落成 `progress:'abort'`。
                     *
                     * PR-D 2b 加了第三档停止位（hard 插话），**顺序是语义**：
                     * `aborted`（终态）> `shutdownStopRequested`（终态）> `hard-steer`（非终态）。
                     * 用户断开时绝不许先消费掉 hard 旗——那会把"客户端已走"的 abort 落档
                     * 变成"插话注入后继续生成"，钱照烧、档没落、连接还不存在。
                     */
                    shouldStop: async () => {
                        if (options.signal?.aborted) {
                            return 'aborted'
                        }
                        if (shutdownStopRequested) {
                            return shutdownStopRequested
                        }
                        return options.hardSteer?.active === true && options.hardSteer.flag ? options.hardSteer.flag : null
                    },
                })
            },
            /** 换档前核一次窗口：装不下就不换，宁可失败也不换成必然失败的 400 */
            fallbackUsable: () => canFallbackTo({
                tokens: promptTokens,
                target: fallbackCfg,
                slackTokens: config.context?.slackTokens,
            }),
            retryAfterMsOf: (e) => parseRetryAfterMs(e?.headers),
            log: (o) => {
                upstreamStats.lastReason = String(o.reason || o.action || '')
                tlog.warn(`上游调用(${tag}) ${o.note}: action=${o.action}, reason=${o.reason}, delayMs=${o.delayMs}`)
            },
        })
        if (ret.usingFallback && fallbackCfg) {
            llmModelUsed = fallbackCfg.key
            upstreamStats.fallbackFrom = llmModel
        }
        return ret.value
    }

    /**
     * @description 账本归属日：用 UTC 的 yyyy-mm-dd，与 day 索引一致
     *
     * 为什么不用本地时区：账本要跨 worker、跨环境对账，本地日期会让"今天"在不同机器上不是同一天。
     * @returns {String} yyyy-mm-dd
     */

    /**
     * @description 上限打满时补一次"无工具收尾调用"：只带 messages 与提示，产出结论并照常流式下发
     * @returns {Promise<Boolean>} 是否拿到了非空正文
     */
    const runFinalizeCall = async () => {
        try {
            /** 预算重核与主循环每轮同口径：这一步也要求解，否则补落反而撑爆上下文 */
            compactToBudget(messages, contextBudget, {tokenizerOptions})
            /** 压缩可能就地改写已有消息 ⇒ 增量测量结果作废，下一轮（若有）重新全量测 */
            budgetMeter.invalidate()
            const finalizeBody = buildFinalizeBody(createBody, messages)
            tlog.info(`无工具收尾调用开始: messages=${finalizeBody.messages.length}, maxIterations=${maxIterations}`)
            const drained = await callUpstream({
                body: finalizeBody,
                promptTokens: budgetMeter.check(messages),
                tag: 'finalize',
                onDelta: (delta) => {
                    options.streamCallback(JSON.stringify({role: 'assistant', ...delta, messageCode}))
                },
            })
            /**
             * 收尾调用也会被打断：同样先并入正文、封存这一段，然后**不谎报"拿到正文"**，
             * 让主循环出口用同一条 abort 路径落档（`persistTurn` 是幂等的，不会写两行）。
             */
            if (drained.stopped) {
                /**
                 * 与主循环同一套判据：真值，不是等值。
                 * `liveAnswerMerged` 为真时抢救已经把正文并进 `answerContent` 了，
                 * 这里再加一次就会出现"档案里同一篇正文写了两遍"。
                 */
                const rescuedFin = liveAnswerMerged
                if (!rescuedFin) {
                    answerContent += drained.content
                    answerReasoning += drained.reasoning
                }
                trackUsage(drained.usage)
                if (drained.content && !rescuedFin) {
                    segments.seal({
                        kind: SEGMENT_KINDS.FINALIZE,
                        text: drained.content,
                        startedAt: roundStartedAt,
                        now: Date.now(),
                    })
                }
                finalizeInterrupted = true
                tlog.warn(`无工具收尾调用被打断: 已保留 ${drained.content.length} 字，走 abort 落档`)
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

    /**
     * PR-M B2 完成性反问（§10.3 决策 (i)(ii)）：模型自称做完（`break` 且已有正文）、但计划仍有未结项时，
     * 无工具再问一次，按 DONE/CONTINUE 决定"保留原答案"还是"并入补充"。三处刻意与 `runFinalizeCall` 不同：
     * 1. **不实时流式**——它的输出可能被丢弃，先缓冲，判定 append 才吐给客户端（否则客户端会收到一段档案里不要的字 ⇒ 分家）；
     * 2. **不置 `forcedFinal`/`finalizeInterrupted`**——那是"空答案被迫补"的语义，这里原答案好好的，借用会污染落库分派；
     * 3. **被打断或失败 ⇒ 保留原答案**，绝不把已经写好的答案拖成 abort。
     * @returns {Promise<Boolean>} 是否并入了补充
     */
    const runSelfCheckCall = async () => {
        if (!currentPlan) {
            return false
        }
        compactToBudget(messages, contextBudget, {tokenizerOptions})
        budgetMeter.invalidate()
        const selfCheckBody = buildFinalizeBody(createBody, messages, buildSelfCheckHint(currentPlan))
        tlog.info(`完成性反问开始: messages=${selfCheckBody.messages.length}, 本轮计划项=${currentPlan.items.length}`)
        try {
            const drained = await callUpstream({
                body: selfCheckBody,
                promptTokens: budgetMeter.check(messages),
                tag: 'self-check',
                /** 缓冲不外发：模型可能只回一个 DONE，那段不该出现在客户端 */
                onDelta: () => {},
            })
            trackUsage(drained.usage)
            if (drained.stopped) {
                tlog.warn('完成性反问被打断：保留原答案，不并入半截反问结果')
                return false
            }
            const verdict = interpretSelfCheckReply(drained.content)
            if (verdict.action === 'append' && verdict.supplement) {
                answerContent += (answerContent ? '\n\n' : '') + verdict.supplement
                iterationCount++
                /** 此前刻意没流式；既然决定并入，补吐给客户端，保持客户端与档案一致 */
                options.streamCallback(JSON.stringify({role: 'assistant', content: verdict.supplement, messageCode}))
                segments.seal({
                    kind: SEGMENT_KINDS.SELF_CHECK,
                    text: verdict.supplement,
                    startedAt: roundStartedAt,
                    now: Date.now(),
                })
                roundStartedAt = Date.now()
                tlog.info(`完成性反问补充并入答案: +${verdict.supplement.length} 字`)
                return true
            }
            tlog.info(`完成性反问：模型确认完成或未附补充（marker=${verdict.marker || 'none'}），保留原答案`)
            return false
        } catch (e) {
            /** 反问是锦上添花，失败/超时都不能拖垮已有答案 */
            tlog.error(`完成性反问调用失败，保留原答案: ${String(e?.message || e).slice(0, 300)}`)
            return false
        }
    }

    /** break 与"被上限掐断"是两种退出，抽取前无法区分（§2E-3 空答案 bug 因此不可观测）*/
    let loopBroke = false
    /** 无工具收尾调用是否被打断（PR-E0.5：打断要走 abort 落档，不能当成"补落成功"） */
    let finalizeInterrupted = false
    /**
     * @description 打断来源：只由"进程是否已在关闭"区分，别用 progress 表达两件事
     * @returns {String} `process-lost`（发版/关机拆连接）或 `client-disconnect`（用户或网络）
     */
    const interruptReason = () => (isClosing() ? 'process-lost' : 'client-disconnect')
    /**
     * @description 取"当前这一轮"的用量快照：派生指标 + 告警判定
     * @returns {{metrics: Object, alert: Object}} 见 `deriveUsageMetrics` 与 `usageCallAlert`
     * @description
     * 这里坚持**每次调用现算**，而不是读两个"稍后由收尾代码赋值"的外层变量。
     * 后者是个真踩过的坑：为了绕 `persistTurn` 的 TDZ 我先给了外层变量初始值，
     * 结果异常/中断路径根本没走到赋值那一行，落库的 `usage.modelCalls` 停在初始的 0，
     * 而同一次的账本行里 `modelCalls` 是真实的 1 —— 同一轮两个数字打架。
     */
    const usageSnapshot = () => ({
        metrics: deriveUsageMetrics(runUsage, modelCalls),
        /**
         * 告警判的是"循环失控"，所以喂给它的必须是**按循环轮次计的次数**，而不是含重试的总发起数。
         * PR-0.5 打开后 `modelCalls` 会把退避重试也算进去：`maxAttempts=3` × 6 轮 = 18 次，
         * 一次纯粹的"relay 在抖"就会踩响 run-away 告警——**那会把最需要看清的两件事搅成一锅**
         * （"我们的循环出问题了" vs "上游不稳定"）。
         * 成本仍然按真实的 `modelCalls` 计（见账本），只是告警口径分开。
         */
        alert: usageCallAlert({
            modelCalls: Math.max(0, modelCalls - upstreamStats.retried),
            maxIterations,
            warnAt: config.limits?.runModelCallsWarn,
            hardAt: config.limits?.runModelCallsHardLimit,
        }),
        /** 告警用的是扣掉重试的口径，这里把扣了多少留在旁边，便于事后核对 */
        retried: upstreamStats.retried,
    })

    /** 上面两个字段供 persistTurn 落库使用，必须先初始化，abort/异常路径才不会撞 TDZ */
    let loopExit = 'unknown'
    let forcedFinal = false
    /** 幂等标记：异常路径与正常路径都调 persistTurn，同一轮只能落一条档 */
    let persisted = false

    /*中断也要留痕：已执行的工具副作用与部分回答需可追溯*/
    /**
     * @description 落库本轮（幂等：同一轮只落一次，异常路径不会造成重复行）
     * @param {String} progress 落库进度：finish/abort/error
     * @param {String} [errorMessage] 异常归因文本，写进 message.error 供历史与排障使用
     * @param {Object} [extra] 附加落档字段
     * @param {String} [extra.interruptedBy] 打断来源：client-disconnect / process-lost。
     *        **单独一列**是刻意的：`progress:'abort'` 必须同时表达"用户按停止"与"发版拆连接"两种事，
     *        而这两种事在运维上是完全不同的问题（前者正常、后者是我们的损失）。
     *        把它们压进一个字段，就等于把 P-10 重新变回"查不出来"。
     * @returns {Promise<void>}
     */
    const persistTurn = async (progress, errorMessage, extra = {}) => {
        if (persisted) {
            /** 重复落库会写出两条同 messageCode 的记录，历史与记忆采集都会翻倍 ⇒ 直接拒绝 */
            tlog.warn(`本轮已落库，忽略重复 persistTurn: progress=${progress}`)
            return
        }
        /**
         * §8.2/D3 的"半句成 `cancelled` 段"：判断规则在 `needsCancelledSegment`（纯函数、有穷举用例），
         * 这里只负责**在唯一落库点**执行一次——写在四个早退点各一遍就会漂移，
         * 而 `persistTurn` 恰好是那四条路径的汇合处。
         *
         * 顺序要求：必须在 `segments.list()` 被读走之前封好，否则档案里就没有这一段；
         * 协议 3 的客户端也只有在**这里**收到 `segment_end{kind:"cancelled"}`，
         * 才不必去猜"这条 abort 到底说到哪儿了"。
         */
        if (needsCancelledSegment({progress, answer: answerContent, sealed: segments.list()})) {
            segments.seal({
                kind: SEGMENT_KINDS.CANCELLED,
                text: answerContent,
                startedAt: roundStartedAt,
                now: Date.now(),
            })
        }
        /** 现算快照：abort/error 路径不会走到收尾代码，读外层"稍后赋值"的变量会拿到初始值 */
        const snap = usageSnapshot()
        /**
         * 本地 tokenizer 量一次正文 token，两处共用（档案 `extInfo.answerTokens` 与账本 `estCompletionTokens`）。
         *
         * 为什么账本要多这一列：2026-11-10 实测，三条被切断的 run 真实生成了
         * **10,772 / 1,986 / 1,934 字**，而账本里 `completionTokens` 合计 **1**——
         * usage 帧在流末尾，客户端一断或容器一死就永远到不了。
         * ⇒ 成本报表对"发版/断开造成的损失"是**系统性低估**的，而这类损失恰恰最需要被算出来。
         * 规矩不变（v1.33 定的）：**估算值单独一列，绝不混进 `completionTokens`/`billablePromptTokens`
         * 这些"上游实测"口径**，否则两种数一旦混在一起就再也分不开谁可信。
         */
        const answerTokensNow = calcTextTokenCount(answerContent + answerReasoning, tokenizerOptions.tokenizer)
        /**
         * 与上面同一个道理：**"稍后赋值"的 `loopExit` 在四个早退点上都还是 `unknown`**
         * （v1.72 dev 实测落在 `progress:abort` + `loopExit:unknown` 的那条记录就是证据）。
         * 在这里现算一次，档案 `extInfo.loopExit` 与账本 `llmUsage.loopExit` **共用同一个值**——
         * 只补其中一张表，就会出现"同一个问题在两张表里给出不同答案"，那比 unknown 更难查。
         */
        const loopExitNow = exitReasonForPersist({progress, loopExit, via: extra.via, closing: isClosing()})
        /** 落一条终态检查点（finish/abort），续跑与审计都以此为准 */
        scheduleCp(progress === 'abort' ? 'abort' : 'final', {
            messages: messages.map(m => ({...m})),
            answer: answerContent,
            toolState: {pendingCalls: [], completedCalls: toolCallTrace.map(t => t.id)},
        })
        /** `llmModelUsed`：换过档就记真正回答这一轮的那个档位，与账本同一口径 */
        await saveMessage(query, messageCode, messages, conversationCode, channel, channelGroup, llmModelUsed, answerContent, answerReasoning, curUserInfo, {
            ...options,
            answerList,
            /**
             * PR-M：本轮计划落 `extInfo.plan`。`planForPersistence` 在没有计划时给 null ⇒
             * 装配清单里写 `plan: options.plan` 后，"本轮没有计划"是 null、不是 `{items:[]}` 空壳
             * （下一轮回读时两者含义不同：一个是没调 update_plan，一个是清空了计划）。
             * 2026-11-16 起**进 messageView**（原"刻意不回显（无界面消费方)"的裁定随消费方出生而失效——
             * callin 调研时间线的"任务树"行读它；视图只透形状，分组文案归前端判据）。
             */
            plan: planForPersistence(currentPlan),
            /**
             * PR-D commit 2：本轮注入过的插话清单（含注入时刻）。与 plan 同取向——
             * "注入过哪些插话"是审计口径（前端从 steer_ack 已经实时拿到过），刻意不进 messageView。
             * （2026-11-16 复核：plan/awaitings 因新消费方进视图，**steerings 不跟**——
             * 插话账 callin 侧本地已有，回读消费方仍未出现；别把"那两个给了"读成"这三个都能给"。）
             * null=没有（不是空壳数组：同"没调 update_plan"与"清空了计划"的区分）。
             */
            steerings: steeringsArchive.length ? steeringsArchive : null,
            /**
             * P-19（2026-11-15 裁定）：ask 回执的档案面。answer_ack 走事件流给"当下在场"的人，
             * awaitings 给"事后审计与重连补看"的人——同一份账的两个出口，不是第二本账
             * （数据只有一个来源：router.ackSnapshot()）。null=本轮没有 ask 投递（同 steerings 的"不是空壳"裁定）。
             * 2026-11-16 起**进 messageView**（时间线"问答卡"行读回执账；账里本就不含答案正文，
             * 外泄边界不因此松动）。
             */
            awaitings: options.answerRouter?.ackSnapshot?.()?.length ? options.answerRouter.ackSnapshot() : null,
            /**
             * PR-I 门观察账（档案面）：enabled/enforce 位 + 有界 40 条裁决。null=门没开过（不是空壳，
             * 同 steerings/awaitings 语义）。观察模式下这是它存在的全部理由——plans 读"如果 enforce 会拦什么"。
             */
            gate: gateLedger.decisions.length ? {enabled: gateOn, enforce: gateEnforce, decisions: gateLedger.decisions, approvals: gateLedger.approvals} : null,
            /** 异常路径的归因（`describeError` 的 kind:message）；正常路径为 null */
            error: errorMessage || null,
            /**
             * §2E-3：把"循环怎么退出的"和"是否补过收尾调用"落进 extInfo，空答案从此可解释、可统计。
             * v1.72：`abort` 落库时循环还没给出原因（四个早退点都在赋值之前），dev 实测就落在
             * `loopExit:unknown` 上——所以这里统一补成 `aborted:<via>` / `shutdown:<via>`，
             * 规则只在这一份，不在四个站点各写一遍（写四遍必然漂移）。
             */
            loopExit: loopExitNow,
            forcedFinal,
            /** PR-B：过程分段。中间正文从此不再只存在于已经断开的那条 SSE 连接里 */
            segments: segments.list(),
            segmentSummary: segments.summary(),
            /** §14/G-6：每 run 用量与调用次数（非缓存 token 为主指标），落进 extInfo 便于逐条下钻 */
            usage: {...runUsage, ...snap.metrics, callAlert: snap.alert.level},
            /** PR-0.5：这一轮重试/换档的现场（没开重试时 attempts 就等于真实轮次、其余字段为空） */
            upstream: {...upstreamStats},
            messageTokens: calcMessagesTokenCount(messages, tokenizerOptions),
            /** 复用 persistTurn 里算好的那一次（同一篇正文量两遍会随正文变长而白烧 CPU） */
            answerTokens: answerTokensNow,
            tokenizerVersion: TOKENIZER_VERSION,
            tools: createBody.tools,
            toolChoice: createBody.tool_choice,
            iterationCount: iterationCount,
            skills: skillContext ? skillChat.getSkillStats(skillContext) : null,
            contextUsage,
            sources: ragSources,
            /**
             * 含 result（trace 侧按 4000 字符截断）与 **args（入参，按 `limits.toolArgsChars` 截断）**。
             * 入参这一份是 PR-H H1 新增的：此前这里只有 id/name/result，
             * 实测 148/148 条调用记录都没有入参 ⇒ "模型这一轮到底查了什么"在档案与流里都是空白。
             * `argsChars`/`argsTruncated` 与 `args` 并列，是为了让"被截了"与"截到多少"不互相污染。
             */
            toolCalls: toolCallTrace.map(t => ({
                id: t.id,
                name: t.name,
                result: t.result,
                args: t.args,
                argsChars: t.argsChars,
                argsTruncated: t.argsTruncated,
            })),
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
            /**
             * 打断来源（只有 abort 路径会有值）：审计与"发版丢了几个"都靠它，见 `persistTurn` 注释。
             *
             * 兜底从 `'unspecified'` 改成**现场计算**（底座教的那一步：它的默认分支一直调
             * `interruptReason()`，所以它根本不会产生我 2026-11-12 在源仓抓到的那类漏点）。
             * 理由不是"名称好听"，而是**静默的默认值会把缺陷藏成数据**：站点忘接线时，
             * 档案里留下的是一条看起来正常的 `unspecified`，
             * 于是"用户按停止"与"发版切连接"的统计从此少算，而且没有任何地方会报错。
             * 现在忘接线的后果是"归因由同一个 `isClosing()` 判据补上"——
             * 站点显式传值仍然优先（RESCUE 之类的特殊来源不能被覆盖）。
             */
            interruptedBy: progress === 'abort' ? (extra.interruptedBy || interruptReason()) : null,
            /**
             * 这条档由哪条路径写下（判据见 `PERSIST_VIA`）。
             * 与 `interruptedBy` 是两个问题：后者说"为什么被打断"，前者说"**谁**把这段字写下来的"——
             * v1.40 那次 0 字 abort 正是"抢救先落档、run 随后跑完却被幂等挡住"，
             * 只有 writtenBy 能把这种顺序事故从日志里读出来。
             */
            writtenBy: extra.via || PERSIST_VIA.UNATTRIBUTED,
            /**
             * P5：发起这一轮时同一会话的上一轮还没终态 ⇒ **本轮上下文不可能包含它**。
             * 这条不是推测出来的告警，是本轮开始前的一个读数，所以它必须进档案：
             * 用户遇到的症状是"它怎么不记得我上一句"，而如果档案里没有这句话，
             * 我们排查时只能看到"两轮都成功"，于是把一个可核对的事实读成模型质量问题。
             * 没有重叠时这里是 `null`（显式空值，不是缺键——缺键与"确认没有"是两件事，同 H1 的教训）。
             */
            runOverlap: options.runOverlap || null,
            /**
             * P3：这一轮是"重新生成"出来的，值是被替换那条的 messageCode；不是重跑时写 **显式 null**。
             * 旧答案不删（产品口径：可能已被引用），所以这条来源就是"哪两条是同一问的重跑"的唯一依据。
             * 重生成既不读也不写答案缓存（见 `regeneration.js`）：
             * 把重跑结果静默覆盖成后续普通请求的答案，是另一个未定的产品决定，不在这一刀里。
             */
            regeneratedFrom: regeneratedFromForArchive(regeneratedFrom),
            /**
             * D44 的留痕：这一轮**到底有没有开深度思考**，以及是被哪一层关掉的。
             * 没有它，"全站聊天一直在无思考模式下运行"就只能靠读代码 + 读 env 反推；
             * 有了它，`extInfo.thinking.effective` 一条查询就能回答，
             * 而且能区分两种"关"：用户明确不要（`requested:'off'`）与档位根本没配（`profileConfigured:false`）。
             * 拿不到决策的路径（回填、抢救）写 **null**——"确认没开"与"这一行还不知道这件事"是两件事。
             */
            thinking: thinkingForArchive(thinkingDecision),
        })
        /** 落库成功才算"已有档案"：放在 saveMessage 之后，这样 saveMessage 自己失败时异常路径还能再补一次 */
        persisted = true
        /** 已经落过档就不再让关闭序列来抢这一条（`persistTurn` 本身幂等，摘掉只是让表不长大） */
        detachArchive(messageCode)
        /**
         * §14 自有账本（G-6）：一行一个 run 的模型用量。
         * 记账失败**绝不影响聊天主链路**（与 totalPrice 沙箱核算、记忆采集同口径），
         * 但必须留下 error 级日志——账本缺行比多花几毛钱严重得多。
         */
        try {
            await llmUsageDac.upsertByMessageCode({
                messageCode,
                conversationCode,
                userCode: curUserInfo?.userCode || '',
                channel,
                /**
                 * 记**真正回答了这一轮的档位**，不是请求要的那个：换档发生后两者不同，
                 * 而账本要能回答"这一轮的钱花在哪个模型上"。与 v1.27 归一非法 llmModel 是同一条原则。
                 */
                llmModel: llmModelUsed,
                upstreamAttempts: upstreamStats.attempts,
                upstreamRetried: upstreamStats.retried,
                fallbackFrom: upstreamStats.fallbackFrom,
                fallbackTo: upstreamStats.fallbackTo,
                day: usageDay(),
                modelCalls,
                promptTokens: runUsage.promptTokens,
                completionTokens: runUsage.completionTokens,
                totalTokens: runUsage.totalTokens,
                cachedTokens: runUsage.cachedTokens,
                billablePromptTokens: snap.metrics.billablePromptTokens,
                reasoningTokens: runUsage.reasoningTokens,
                hasUsage: snap.metrics.hasUsage,
                /**
                 * 本地估算的输出 token。**与 `completionTokens` 分列**：后者只有上游回传才有值，
                 * 而被掐断的 run 永远拿不到回传 ⇒ 只有估算列能回答"这次损失实际生成了多少"。
                 */
                estCompletionTokens: answerTokensNow,
                callAlert: snap.alert.level,
                /** 与档案 `extInfo.loopExit` 同一个现算值：两张表对同一个问题必须给同一个答案 */
                loopExit: loopExitNow,
                progress,
                latencyMs: Date.now() - turnStart,
                // M6：与在途刷新**同一个 helper**——两处字段清单就是"双处白名单"，一致性靠共用构造器保证，
                // 不靠"记得两边都改"（本仓 §2E-2 那类"配置漂移"就是两处各写一遍写出来的）
                ...buildUsageCreditsFields({
                    promptTokens: runUsage.promptTokens, completionTokens: runUsage.completionTokens,
                    model: (config.models || {})[llmModelUsed], weights: config.credits?.weights,
                }),
                // §5-4：任务关联三列与在途刷新同一提取器（同一份白名单判定，两处不许各写一遍）
                ...extractTaskFields({taskContext: options.taskContext}),
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
     * 停机抢救的本地停止位：`archiveAllInflight` 落档时置真，由 `shouldStop` 在下一帧停下生成。
     *
     * 为什么落档与停止**必须一起来**：只落一条 `abort` 档而让生成继续跑到自然结束，
     * 结果是档案停在抢救那一刻的内容、上游又白生成几十秒，而 `persistTurn` 的幂等保护
     * 又会把真正的结尾丢掉——**两头都错，还都看不出来**。
     * 取舍要写明：落在"距强制退出只剩 ${CLOSE_ARCHIVE_RESERVE_MS}ms"这个窗口里的 run 会被主动截断，
     * 宁可它显示成一条可见的 `abort`，也不要一条"其实写完了却查无此轮"的记录。
     */
    let shutdownStopRequested = null
    /**
     * 停机抢救用的落档函数（`run` 与 `archives` 两张表分开的原因见 `runRegistry` 注释：
     * 闸默认关着、那张表恒空，复用它就等于默认配置下没人被抢救）。
     */
    attachArchive(messageCode, async () => {
        /**
         * 抢救必须**同时停止花钱**：只落一条 abort 档而让生成继续跑到自然结束，
         * 结果是"档案停在 40 秒的内容、上游又生成到 90 秒"，那份多出来的钱没人认领，
         * 而 `persistTurn` 幂等又会把真正的结尾丢掉——两头都错。
         * 所以这里置一个本地停止位，由 `shouldStop` 在下一帧把生成停下来。
         */
        shutdownStopRequested = 'shutdown-archive'
        /**
         * 第二步才是兜底落档，顺序不能反。真实滚动验收（§25 v1.40）证明：
         * 一上来就 persistTurn 必然写出 **0 字 abort** —— 那一刻正文还锁在
         * `drainAssistantStream` 的局部变量里，`answerContent` 是空的；
         * 而这条档一旦落下，`persistTurn` 的幂等保护就会把随后真正完整的收尾**永久挡在门外**
         * （实测：客户端明明收到了 6,898 字的完整回答，档案却是空的）。
         * 所以先只下停止位，给 run 自己早退并带正文落档留一整段等待。
         */
        const tWait = Date.now()
        while (!persisted && Date.now() - tWait < CLOSE_ARCHIVE_WAIT_FOR_RUN_MS) {
            await new Promise(res => setTimeout(res, 50))
        }
        if (persisted) {
            tlog.info(`抢救只下了停止位，run 自己落档完成: 等待ms=${Date.now() - tWait}, answerLen=${answerContent.length}`)
            return
        }
        /**
         * 兜底：run 一帧都没再回来（卡在上游或事件循环），此时唯一能拿到的正文就是 liveAnswer。
         *
         * **但没内容时绝不写这条档**（§25 v1.41 的读数逼出来的）：上一版在这里无条件落档，
         * 实测 T+40s 兜底时 relay 还没吐字（正文 0），于是写出一条 `abort` + 0 字，
         * 而 3.8 秒后真正的 `finish`（5,780 字）被 `persisted` 幂等永久挡在门外 ⇒
         * **用户拿到了完整回答，档案却是空的**。这比原来"什么都不留"更误导。
         *
         * 分工因此要说清：
         * - 有正文 ⇒ 抢救写 abort（带着能拿到的那部分），这是真损失；
         * - 没正文 ⇒ 什么都不写，让 `processing` 留着，由回填扫描在**确认进程已死**后补一条
         *   "你当时问了什么 + 被中断"（它有无档案这道前置检查，本来就该它做）。
         */
        const mergedLive = mergeLiveAnswer()
        const hasContent = answerContent.length > 0 || answerReasoning.length > 0
        if (!hasContent) {
            tlog.warn(`抢救未落档: 等待ms=${Date.now() - tWait} 后仍无正文（reasoning 也空）。`
                + '留给回填扫描处理——写一条 0 字 abort 会挡住随后真正的 finish')
            return
        }
        await persistTurn('abort', 'shutdown:process-lost', {interruptedBy: 'process-lost', via: PERSIST_VIA.RESCUE})
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
        /**
         * P5：同会话重叠的事实必须**在这条流里就说出来**，不能只留在档案里。
         * 2026-11-13 双标签页实测：档案有 `runOverlap`（`prevAgeMs=2582, contextMissing=true`），
         * 但实时界面什么也没说；**重新进入会话**（走 `/core/message/list` 回填）之后那句
         * "本轮上下文不含上一轮"才出现。也就是说最需要它的那一刻——用户正在等这一轮——它不说话。
         *
         * 这里发的是**事实**（对象或 null），措辞仍由前端判据决定。
         * 前端 provider 的 `case 'meta'` 是白名单，**不加一行就收不到**：两侧都要改，
         * 单边改完症状一模一样，很容易被误判成"改了没用"。
         * 形状守卫在 `test/services/core/segmentEvents.test.js`，删掉本行会变红（已实测）。
         */
        runOverlap: options.runOverlap || null,
    })

    /** 同上：`>= 2`，协议 3 不能丢掉 `sources`（理由见 meta 那处的注释） */
    if (clientProtocol >= 2 && ragSources.length && options.streamCallback) {
        options.streamCallback(JSON.stringify({sources: ragSources}), 'sources')
    }

    /**
     * PR-I 门筛查（接线刀的单点）：除 ask_user 外全部动作进门——读-only 面也一律走层 1
     * （规则短路是层 1 的职责，这里不预设哪个面"肯定安全"）。观察模式下三态全部放行只记账——
     * enforce 施加与否是接线方的行动开关，裁决纯度归编排（decideGate）。
     */
    async function gateScreenCalls(calls) {
        const passed = []
        const blocked = []
        for (const tc of calls) {
            const action = gateClassifyAction({toolName: tc?.function?.name, argsText: tc?.function?.arguments})
            if (!gateClassifyFn) {
                gateClassifyFn = makeGateClassifyFn({modelKey: gateCfg.classifierModel || 'relay_qwen_low', modelsCfg: config.models})
            }
            const r = await decideGate({
                action,
                rules: gateCfg.rules || SEED_GATE_RULES,
                classifyFn: gateClassifyFn,
                recentVerdicts: gateLedger.verdicts,
                gateDecisionsThisRun: gateLedger.decisions.length,
                budget: {consecutive: gateCfg.consecutive, perRunBudget: gateCfg.perRunBudget},
                askAvailable: askOn && !!options.answerRouter,
            })
            gateLedger.verdicts.push(r.verdict === 'await-human' ? 'escalate' : r.verdict)
            let applied
            if (!gateEnforce) {
                applied = 'observed:' + r.verdict
                passed.push(tc)
            } else if (r.verdict === 'allow') {
                applied = 'allow'
                passed.push(tc)
            } else if (r.verdict === 'block') {
                applied = 'blocked'
                blocked.push({tool_call_id: tc?.id, role: 'tool',
                    content: JSON.stringify({success: false, gated: true,
                        error: `执行门拦截（${r.source}:${r.reason}），请换安全路径或向用户说明`})})
            } else {
                const ok = await gateAwaitApproval(tc, r)
                if (ok) {
                    applied = 'approved'
                    passed.push(tc)
                } else {
                    applied = 'human-deny'
                    blocked.push({tool_call_id: tc?.id, role: 'tool',
                        content: JSON.stringify({success: false, gated: true,
                            error: `人工裁决未放行执行（门判定：${r.reason}）`})})
                }
            }
            if (gateLedger.decisions.length < 40) {
                gateLedger.decisions.push({tool: tc?.function?.name, source: r.source, verdict: r.verdict,
                    applied, rule: r.rule || undefined, overrode: r.overrode || undefined, raw: r.raw || undefined})
            }
        }
        return {passed, blocked}
    }

    /**
     * await-human 复用 awaitAskUser 的 MRTR 管道（合成一道 approval 题）：
     * kind:'approval' 走 §2F.4 已裁的既有 admission（只接受发起人）——审批政策不为门另开第二条路；
     * askId 前缀 gate- 让档案可分辨这是门确认而非用户提问。ask 未开时到不了这里
     * （decideGate 的 askAvailable=false 已给 block;human-unavailable——过渡语义自显形）。
     */
    async function gateAwaitApproval(toolCall, r) {
        gateLedger.approvals++
        const synth = {
            id: `gate-${messageCode}-${gateLedger.approvals}`,
            function: {
                name: 'ask_user',
                arguments: JSON.stringify({
                    kind: 'approval',
                    inputRequests: [{mode: 'form',
                        message: `执行门：工具 ${toolCall?.function?.name} 需人工裁决（${r.source}:${r.reason}）。允许本次执行吗？`,
                        requestedSchema: {type: 'object', properties: {gate: {type: 'string', enum: ['allow', 'deny']}}, required: ['gate']}}],
                }),
            },
        }
        const msg = await awaitAskUser({
            toolCall: synth, router: options.answerRouter, secret: answerSecret(),
            askConfig: askCfg, checkpointSeq: iterationCount, signal: options.signal,
            streamEvent: (type, payload) => {
                if (options.streamCallback) {
                    try {
                        options.streamCallback(JSON.stringify(payload), type)
                    } catch { /* 同 ask 主站点：事件失败不反噬挂起，账在 router */ }
                }
            },
        })
        try {
            const c = JSON.parse(msg.content)
            return c.resultType === 'complete' && c.inputResponses?.gate === 'allow'
        } catch {
            return false
        }
    }

    /**
     * 主循环与其收尾（含退出方式判定、无工具收尾补落、落库与缓存）整体受 try/catch 保护。
     * 用整段包裹而不是逐处 try：需要兜住的抛点有 create、流消费、四类工具分派、技能检测、预算压缩等多处，
     * 逐个包必然会漏，而漏掉的那个恰好会让 persistTurn 被跳过。
     */
    try {
        while (iterationCount < maxIterations) {
            if (options.signal?.aborted) {
                /** 入口命中：这次迭代什么都没做，钱没花；与出口的损失量级不同，所以标签也不同 */
                await persistTurn('abort', null, {interruptedBy: interruptReason(), via: PERSIST_VIA.LOOP_ENTRY})
                return 'aborted'
            }

            iterationCount++
            roundStartedAt = Date.now()
            /**
             * 工具循环会持续往 messages 里塞结果，每轮请求前都要核对预算——但**不再每轮全量重算**。
             *
             * 这一刀的口径（v1.20，探针 P-15 实测后缩小）：
             * - dev 96 条带预算的样本里 **越界 0 次、最大 total/budget 只有 5.80%**，
             *   也就是 `compactToBudget` 在里面**从未真正改写过任何一条消息**；
             *   所以"每轮重写历史前缀"这个说法不成立，成立的部分只是**每轮一次全量 tokenize 的 CPU**
             *   （6 轮迭代 = 6 次全量重算，O(n²)）。
             * - `calcMessagesTokenCount` 是逐条 reduce ⇒ 总量严格等于各条之和 ⇒ **增量测量与全量等价**，
             *   不是近似（等价性由用例钉住）。
             * - 越界时的安全网原样保留：真越界仍会压缩，压完 `invalidate()` 让下一轮重算。
             * - **缓存与前缀稳定性收益为 0**（P-2b 已证上游只隐式缓存 system 段），别按那个理由改这里。
             */
            let loopTokens = budgetMeter.check(messages)
            if (loopTokens > contextBudget) {
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
            /** 计数点在发起请求处（不是拿到 usage 处）：被打断的调用照样花了钱，见 `trackCall` 注释 */
            /**
             * PR-0.5：这里换成 `callUpstream`。
             * `promptTokens` 传本轮装配后的估算值——它是"能不能换档"的唯一依据：
             * 备选档窗口比这轮要发的小，换过去就是拿一次 503 换一次必然失败的 400。
             */
            /**
             * PR-M recitation（§10.1②）：把当前计划重述拼在**这一轮发送副本**的尾部，对抗长循环目标漂移。
             * 关键：绝不 `push` 进累积历史 `messages`——那样第 N 轮会背着前 N−1 轮的所有 recitation 副本，
             * 还会把我们注入的提示当成对话内容落档。`withRecitation` 只在有新计划时返回**新数组**，
             * 关着 / 还没计划时返回同一个 `messages` 引用，于是下面连 body 都能复用 createBody 本体、零额外拷贝。
             */
            const sendMessages = planOn
                ? withRecitation(messages, currentPlan, {enabled: planOn, maxChars: planCfg.recitationMaxChars})
                : messages
            /**
             * hard 插话的生成窗：arm 只在这对 try/finally 之间敞开。
             * finalize / self-check 两处 callUpstream **不 arm**——它们的 stopped 各有终态语义
             * （前者落 abort、后者保原答案），被 hard 旗误伤就是把收尾/反问掐成孤儿。
             * disarm 放 finally：create 抛错（网络/配额）时闸必须合上，否则 flag 会漏进下一窗。
             */
            if (options.hardSteer) {
                options.hardSteer.active = true
            }
            let drained
            try {
                drained = await callUpstream({
                    body: sendMessages === messages ? createBody : {...createBody, messages: sendMessages},
                    promptTokens: loopTokens,
                    tag: `iter=${iterationCount}`,
                    onDelta: (delta) => {
                        options.streamCallback(JSON.stringify({role: 'assistant', ...delta, messageCode}))
                    },
                })
            } finally {
                if (options.hardSteer) {
                    options.hardSteer.active = false
                }
            }
            /**
             * PR-D commit 2b：hard 插话的打断现场——四种停止位里**唯一的非终态出口**。
             * 位置判据（顺序锚钉死）：必须在终态 `if (drained.stopped)` **之前**；
             * 写反了 hard-steer 会被终态分支吃掉，静默变成一次 abort 落档——用户视角是"我插话它停了"。
             * 停花钱的机制与 shutdown 抢救同款：drain 的 break 触发 iterator.return ⇒
             * undici 取消响应体 ⇒ 上游断线自停。不需要 AbortController 去碰重试层的错误分类。
             */
            if (drained.stopped === 'hard-steer' && options.hardSteer && options.runMailbox) {
                options.hardSteer.flag = null
                const rescuedHS = liveAnswerMerged
                if (!rescuedHS) {
                    answerContent += drained.content
                    answerReasoning += drained.reasoning
                }
                trackUsage(drained.usage)
                if (drained.content && !rescuedHS) {
                    segments.seal({
                        kind: SEGMENT_KINDS.ANSWER,
                        text: drained.content,
                        startedAt: roundStartedAt,
                        now: Date.now(),
                    })
                }
                /** 半句是作废的草稿：并段清零（同工具轮的处理），否则新答案会拼在断掉的半句尾巴上 */
                answerContent && answerList.push(answerContent)
                answerContent = ''
                const hsCfg = config.controlConfig || {}
                const pulled = options.runMailbox.pullBoundary({
                    expiryMs: Number(hsCfg.steerExpiryMs) || undefined,
                    limit: Number(hsCfg.steerBoundaryLimit) || undefined,
                })
                if (pulled.toInject.length) {
                    const {block} = renderSteeringBlock(pulled.toInject)
                    messages.push({role: 'user', content: block})
                    for (const s of pulled.toInject) {
                        steeringsArchive.push({...s, injectedAt: Date.now()})
                        /**
                         * ack 的决策从 `llmLoop.steerAction(mode, 'generating')` **读**，不写死——
                         * v1.13 定的判据到这才真正被消费；hard 在这里就是 {immediate, abort:true}，
                         * 同队蹭到的 soft 如实拿 {boundary, false}（注入现场是边界，哪怕边界是打断造出来的）。
                         */
                        if (options.streamCallback) {
                            options.streamCallback(JSON.stringify({
                                ...steerAckPayload(s, steerAction(s.mode, 'generating')),
                                messageCode,
                            }), 'steer_ack')
                        }
                    }
                } else {
                    /** 理论不可达：置位方先 push 后进队尾，队尾不会被去重/过期挤掉。真到了就是判据有洞，如实喊 */
                    tlog.warn('hard 打断现场取件为空（置位与取件的判据分家，排查线索）')
                }
                for (const d of pulled.dropped) {
                    tlog.warn(`插话在打断边界未注入即弃 steerCode=${d.steerCode}: ${d.reason}`)
                }
                roundStartedAt = Date.now()
                /** 客户端的半句必须抹掉重写（同工具轮的 reset），否则前端把新答案接在半句后面 */
                emitReset()
                tlog.warn(`hard 插话打断生成: iter=${iterationCount}, chunks=${drained.chunkCount}, `
                    + `保留半句=${drained.content.length}字, 注入=${pulled.toInject.length}, 弃=${pulled.dropped.length}`)
                continue
            }
            /**
             * drain 早停 ⇒ **这一轮已经被打断**，必须就地收尾，不能带着半截正文继续往下走。
             *
             * 判据必须是**真值**，不能写 `=== 'aborted'`。真实滚动验收（§25 v1.40）就是这么错的：
             * 抢救路径置的停止位是 `'shutdown-archive'`，被等值判断整个漏掉 ⇒
             * run 继续跑完、`finish` 又被 `persisted` 幂等挡掉，档案永远停在抢救那条 **0 字 abort** 上，
             * 而客户端明明收到了 6,898 字完整回答。
             *
             * 正文来源也分两种：
             * - 正常打断：`drained.content` 就是 drain 已累计的全部 ⇒ 直接并入；
             * - 抢救已经并过（`liveAnswerMerged`）：那时 `answerContent` 已经是同一份内容的引用，
             *   **再累加一次就会变成两份** ⇒ 跳过。
             */
            if (drained.stopped) {
                const rescued = liveAnswerMerged
                if (!rescued) {
                    answerContent += drained.content
                    answerReasoning += drained.reasoning
                }
                trackUsage(drained.usage)
                if (drained.content && !rescued) {
                    segments.seal({
                        kind: SEGMENT_KINDS.ANSWER,
                        text: drained.content,
                        startedAt: roundStartedAt,
                        now: Date.now(),
                    })
                }
                roundStartedAt = Date.now()
                await persistTurn('abort', null, {interruptedBy: interruptReason(), via: PERSIST_VIA.EARLY_STOP})
                tlog.warn(`流被打断并就地落档: reason=${drained.stopped}, answerLen=${answerContent.length}, `
                    + `chunkCount=${drained.chunkCount}, 抢救已并过正文=${rescued}`)
                return 'aborted'
            }
            answerContent += drained.content
            answerReasoning += drained.reasoning
            /** 本 run 的用量与调用次数计数点：每一轮 create 都算一次，越往后越能看出是不是在打循环 */
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
             * 抽取前是两条互斥的 if（`!receivedToolCall && ...` 与 `receivedToolCall && ...`），
             * 这里换成一次判定，分支条件与顺序不变，抽出来是为了能离线穷举（见 llmLoop.test.js）。
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

                    /**
                     * PR-I 门 choke point：分派前筛查。ask_user 豁免——escalate 的人工通道正是 ask 本身，
                     * 给它再过门是循环等待（豁免的理由是循环性，不是"它安全"）。
                     * 关闭时（!gateOn）一次调用都不做，连筛查函数都不进——"关着不可见"的实现形态。
                     */
                    let gateBlockedResults = []
                    let gatePassedCalls = toolCalls
                    if (gateOn) {
                        const screened = await gateScreenCalls(askOn ? toolCalls.filter((tc) => !isAskTool(tc?.function?.name)) : toolCalls)
                        gatePassedCalls = screened.passed
                        gateBlockedResults = screened.blocked
                    }
                    /** 记忆、溢出取回、沙箱代码执行、计划更新、产物登记、人机提问、附件读回、澄清申报都要单独分派：否则会被当成 MCP 工具丢给 mcpToolManager 而找不到实现 */
                    const {memoryCalls, overflowCalls, codeCalls, planCalls, artifactCalls, askCalls, attachmentCalls, clarifyCalls, featureCalls, otherCalls} =
                        classifyToolCalls(gatePassedCalls, {isMemoryTool, isOverflowTool, isCodeTool, isPlanTool, isArtifactTool: (n) => isSaveArtifactTool(n) || isReadArtifactTool(n), ...(askOn ? {isAskTool} : {}), ...(attachOn ? {isAttachmentTool: isReadAttachmentTool} : {}), ...(clarifyOn ? {isClarifyTool: isClarifyRequestTool} : {}), ...(featureCatalogOn ? {isFeatureTool: isFeatureCatalogTool} : {})})
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
                            context: {conversationCode, userCode: curUserInfo?.userCode, channel, messageCode},
                        })))
                    /**
                     * PR-M：update_plan 是纯同步工具（不碰 DB/沙箱），执行即把归一后的计划回给模型看；
                     * 同时把**最后一次成功写入的 items** 记进 `currentPlan`，供本轮后续迭代的 recitation 与收尾落档用。
                     * 一次批次里若模型调了多次，以最后一条有效为准（与"整份替换"语义一致）。
                     */
                    const planResults = planCalls.map(toolCall => {
                        const msg = executePlanTool({toolCall, planConfig: planCfg})
                        try {
                            const parsed = JSON.parse(msg.content)
                            if (parsed?.success && Array.isArray(parsed.data?.items) && parsed.data.items.length) {
                                currentPlan = {items: parsed.data.items}
                            }
                        } catch { /* 解析失败不影响把原消息回给模型：它自己会看到 success:false 与 error */ }
                        return msg
                    })

                    /**
                     * PR-H2：artifact 通道（save_artifact → intake；read_artifact → 查账+doc.api 读回）。
                     * 懒 import 是刻意的：artifactCalls 为空就连 runner/intakeWiring 都不加载（默认关路径零副作用）。
                     * save 侧沙箱复用 run_code 的会话绑定箱（peekSharedSandboxId，进程内语义与其一致）；
                     * 没有箱就如实回 success:false——产物必先由 run_code 在沙箱里产生，工具不替模型"凭空建箱"。
                     */
                    let artifactResults = []
                    if (artifactCalls.length) {
                        const [{peekSharedSandboxId}, {makeIntakeRunner, makeArtifactReader, genCode}] = await Promise.all([
                            import('../sandbox/runner.js'),
                            import('./artifact/intakeWiring.js'),
                        ])
                        const intakeRunner = makeIntakeRunner({
                            docApiConfig: config.docApiConfig || {},
                            artifactConfig: artifactCfg,
                            userInfo: {userCode: curUserInfo?.userCode || '', realName: curUserInfo?.realName || ''},
                            streamEvent: (type, payload) => {
                                if (options.streamCallback) {
                                    try { options.streamCallback(JSON.stringify(payload), type) } catch { /* 事件投递失败不反噬工具结果：账行 ready 才是权威 */ }
                                }
                            },
                        })
                        /** read 侧只吃 dac+doc.api（不碰沙箱），与 save 同一开关、同一身份 */
                        const artifactReaderDeps = makeArtifactReader({
                            docApiConfig: config.docApiConfig || {},
                            userInfo: {userCode: curUserInfo?.userCode || '', realName: curUserInfo?.realName || ''},
                        })
                        artifactResults = await Promise.all(artifactCalls.map(toolCall => isReadArtifactTool(toolCall?.function?.name)
                            ? executeReadArtifactTool({toolCall, artifactConfig: artifactCfg, deps: artifactReaderDeps})
                            : executeSaveArtifactTool({
                                toolCall,
                                context: {
                                    conversationCode,
                                    channel,
                                    userCode: curUserInfo?.userCode,
                                    /** 幂等键的 run 段=messageCode：本轮回答即本次 run（llmChat 没有独立 runCode） */
                                    runCode: messageCode,
                                    sandboxId: peekSharedSandboxId(conversationCode),
                                },
                                artifactConfig: artifactCfg,
                                sandboxConfig: config.sandboxConfig || {},
                                runIntake: intakeRunner,
                                genCode,
                            })))
                    }

                    /**
                     * PR-E：ask_user 通道。挂起发生在**这里**（awaitAskUser 内 await router.register 的 promise），
                     * 挂起期间上游不计费、SSE 保留、并发闸照常占格——这是"进程内等待"形态的明码标价，
                     * 换掉它需要 cp 读侧的续跑机制（未建，见 §25 记录）。
                     * Promise.all 并发等多个问题：各自的 promise 独立 resolve，先到先得在 router 单点裁决。
                     */
                    let askResults = []
                    if (askCalls.length) {
                        if (!askOn) {
                            /** 到不了这里（关着时谓词没注入）；真到了就是分类与开关分家，如实回给模型而不是静默吞 */
                            askResults = askCalls.map(tc => ({tool_call_id: tc.id, role: 'tool', content: JSON.stringify({success: false, error: 'ask_user 未启用'})}))
                        } else {
                            askResults = await Promise.all(askCalls.map(toolCall => awaitAskUser({
                                toolCall,
                                router: options.answerRouter,
                                secret: answerSecret(),
                                askConfig: askCfg,
                                checkpointSeq: iterationCount,
                                signal: options.signal,
                                streamEvent: (type, payload) => {
                                    if (options.streamCallback) {
                                        try { options.streamCallback(JSON.stringify(payload), type) } catch { /* 事件失败不反噬挂起：账在 router */ }
                                    }
                                },
                            })))
                        }
                    }

                    /**
                     * B-1：read_attachment 执行段（懒 import 同 artifact 纪律——attachmentCalls 为空
                     * 连 docApiExtract/agentTaskDac 都不加载）。root 快照经 getTop 现取：
                     * 授权面=发起那一刻落在 root 行上的事实，child 循环每一跳都重新对表（重放/追活同样受表）。
                     */
                    let attachmentResults = []
                    if (attachmentCalls.length) {
                        const [{makeExtractDeps}, agentTaskDacMod] = await Promise.all([
                            import('./attachment/docApiExtract.js'),
                            import('../../daos/core/dac/agentTaskDac.js'),
                        ])
                        const agentTaskDac = agentTaskDacMod.default
                        attachmentResults = await Promise.all(attachmentCalls.map(async (toolCall) => executeReadAttachmentTool({
                            toolCall,
                            taskContext: options.taskContext,
                            limits: {maxChars: attachCfg.maxChars},
                            deps: {
                                getRootParams: async (rootCode) => {
                                    const rows = await agentTaskDac.getTop(1, {complexFilter: {agentCode: rootCode}})
                                    return rows?.[0]?.params || null
                                },
                                extractText: makeExtractDeps({
                                    docApiConfig: config.docApiConfig || {},
                                    userInfo: {userCode: curUserInfo?.userCode || '', realName: curUserInfo?.realName || ''},
                                }),
                            },
                        })))
                    }
                    /**
                     * §7-1：澄清申报执行段。**恒不挂起**——受理进 sink（进程内，agentChat 收）
                     * 并立刻 ack"请收尾"。sink 抛错如实回（申报没进去却说已转交=第二本假账）。
                     */
                    let clarifyResults = []
                    if (clarifyCalls.length) {
                        clarifyResults = clarifyCalls.map((toolCall) => {
                            const parsed = parseClarifyRequest(toolCall?.function?.arguments)
                            if (!parsed.ok) {
                                return {tool_call_id: toolCall?.id || '', role: 'tool', content: JSON.stringify({success: false, error: `澄清申报未受理：${parsed.reason}`, tool: CLARIFY_TOOL_NAME})}
                            }
                            try {
                                options.clarifySink(parsed)
                            } catch (e) {
                                return {tool_call_id: toolCall?.id || '', role: 'tool', content: JSON.stringify({success: false, error: `澄清申报登记失败：${String(e?.message || e).slice(0, 160)}`, tool: CLARIFY_TOOL_NAME})}
                            }
                            return {tool_call_id: toolCall?.id || '', role: 'tool', content: JSON.stringify({
                                success: true,
                                data: {recorded: true},
                                hint: '申报已转交主任务统一出题；本轮请基于已知信息完成并在正文标注假设，用户答复会随下一轮交回。',
                                tool: CLARIFY_TOOL_NAME,
                            })}
                        })
                    }
                    // 执行工具调用（区分 MCP 工具和 Skill 工具）
                    let otherResults = []
                    /**
                     * 功能目录检索执行段（刀2）：身份=userCode 单源（B0-1 同源），deps 不注入=
                     * 默认 IO（grpcSkill 装配管道+逐码 hasPriv）；审计 sink 留空=刀4 接账面
                     * （壳已容缺，账不阻塞检索）。executeFeatureCatalogSearch 自捕全部 IO 异常
                     * 回分态 JSON，绝不向上抛——一次目录故障不该炸整轮。
                     */
                    const featureResults = await Promise.all(featureCalls.map(async (toolCall) => {
                        let args = {}
                        try { args = JSON.parse(toolCall?.function?.arguments || '{}') } catch { /* 按空参数，检索自会回 miss 形状 */ }
                        const content = await executeFeatureCatalogSearch({
                            keyword: String(args.keyword || ''), userCode: curUserInfo?.userCode || '', channel,
                            conversationCode, runCode: messageCode,
                        })
                        return { toolCallId: toolCall.id, role: 'tool', name: FEATURE_SEARCH_TOOL_NAME, content }
                    }))
                    if (otherCalls.length) {
                        /**
                         * skill 写面幂等闸（B-4 二期前置，默认关）：开闸时逐条过 `skillWriteGate`
                         * ——写面白名单命中且键齐 ⇒ 查账/claim/settle，其余档位**同序同形**直通
                         * （旧执行面本来就是 for-await 串行，per-call 包裹不引入新并发）。
                         * 关闸连闸模块都不 import——懒 import 纪律同 globalRunGate/artifact/intakeWiring。
                         */
                        const writeGateCfg = config.limits?.skillWriteIdempotency || {}
                        if (writeGateCfg.enabled === true) {
                            const {runToolCallsWithWriteGate} = await import('./skill/skillWriteGate.js')
                            otherResults = await runToolCallsWithWriteGate({
                                calls: otherCalls,
                                /** 幂等键的 run 段=messageCode：与 artifact 键同口径（:1902 注释单源） */
                                runCode: messageCode,
                                cfg: writeGateCfg,
                                context: {conversationCode, userCode: curUserInfo?.userCode || ''},
                                execOne: (toolCall) => skillContext
                                    ? skillChat.executeSkillToolCalls([toolCall], skillContext)
                                    : mcpToolManager.executeToolCalls(channel, [toolCall]),
                            })
                        } else {
                            otherResults = skillContext
                                ? await skillChat.executeSkillToolCalls(otherCalls, skillContext)
                                : await mcpToolManager.executeToolCalls(channel, otherCalls)
                        }
                    }
                    const toolResults = [...gateBlockedResults, ...memoryResults, ...overflowResults, ...codeResults, ...planResults, ...artifactResults, ...askResults, ...attachmentResults, ...clarifyResults, ...featureResults, ...otherResults]

                    /*工具结果只带 tool_call_id，前端无法据此显示调用了哪个工具，这里补上名称*/
                    const nameById = buildToolNameIndex(toolCalls)
                    /** 入参与名字同批反查：两处 trace 写入点（溢出/普通）都要带上，漏一处就是"有的调用看得见参数有的看不见" */
                    const argsById = buildToolArgsIndex(toolCalls)
                    const argsCap = config.limits?.toolArgsChars
                    const resultCap = config.limits?.toolResultTraceChars

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
                            toolCallTrace.push(buildToolCallTraceEntry(toolResult.tool_call_id, toolName, toolResult.content, {argsById, argsCap, resultCap}))
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
                        toolCallTrace.push(buildToolCallTraceEntry(toolResult.tool_call_id, toolName, toolResult.content, {argsById, argsCap, resultCap}))

                        /*协议 1 的旧客户端会把 data.content 无条件拼进答案，因此仅在协议 2 或显式开启时下发*/
                        if (emitToolResults && options.streamCallback) {
                            /**
                             * 入参一并下发。理由很具体：只落库不下发的话，同一轮里
                             * "实时看不到参数、刷新后看得到"会变成用户以为的 bug（前端会去找一个不存在的差异）。
                             * `argsChars`/`argsTruncated` 同时给出，前端不必猜正文是不是被裁过。
                             */
                            const argsSnapshot = clipTraceArgs(argsById[toolResult.tool_call_id], argsCap)
                            options.streamCallback(JSON.stringify({
                                role: 'tool',
                                content: toolResult.content,
                                tool_call_id: toolResult.tool_call_id,
                                tool: toolName,
                                args: argsSnapshot.args,
                                argsChars: argsSnapshot.argsChars,
                                argsTruncated: argsSnapshot.argsTruncated,
                                messageCode
                            }), 'tool_result')
                        }
                    }

                    /**
                     * PR-D commit 2：soft 插话的边界注入——mailbox 的唯一消费点。
                     * 位置判据：工具结果已并入、段将封存、`postTools` 检查点就在几行之后——
                     * 注入的消息随检查点一起留存，崩溃续跑不会把"已消费过的插话"再当新消息灌一遍。
                     * 单发答案（无工具轮）**没有这个边界** ⇒ 插话等到过期被弃：soft 的语义是"插话不打断"，
                     * 不是"为插话再起一轮"——那是 hard/2b 的手术面，别在这里越权。
                     * 异常整段兜住：注入失败只是少一条输入，把主循环炸了才是丢整轮（治理件不许成为新故障源）。
                     */
                    if (options.runMailbox) {
                        try {
                            const steerCfg = config.controlConfig || {}
                            const {toInject, dropped} = options.runMailbox.pullBoundary({
                                expiryMs: Number(steerCfg.steerExpiryMs) || undefined,
                                limit: Number(steerCfg.steerBoundaryLimit) || undefined,
                            })
                            /**
                             * hard 的停止位语义是"队里有条 hard 想掐当前生成"——**任何清队的 pull
                             * 都必须连旗一起清**，否则本边界消费了那条 hard、旗却漏到下一个生成窗，
                             * 把下一轮的首帧凭空打断（self-interrupt 竞态，写这块时推演出来的）。
                             */
                            if (options.hardSteer) {
                                options.hardSteer.flag = null
                            }
                            for (const d of dropped) {
                                tlog.warn(`插话未注入即弃 steerCode=${d.steerCode}: ${d.reason}`)
                            }
                            if (toInject.length) {
                                const {block} = renderSteeringBlock(toInject)
                                messages.push({role: 'user', content: block})
                                for (const s of toInject) {
                                    steeringsArchive.push({...s, injectedAt: Date.now()})
                                    /** steer_ack 只承诺"已在 postTools 边界注入"，不承诺模型照办——文案与通道同一诚实度 */
                                    if (options.streamCallback) {
                                        options.streamCallback(JSON.stringify({
                                            ...steerAckPayload(s, {injectAt: 'postTools', abortCurrentStream: false}),
                                            messageCode,
                                        }), 'steer_ack')
                                    }
                                }
                            }
                        } catch (e) {
                            tlog.error(`插话注入异常（本轮继续）: ${String(e?.message || e).slice(0, 160)}`)
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
            /** 出口命中：这一轮的迭代已经跑完（可能含工具批），停在安全边界上 */
            await persistTurn('abort', null, {interruptedBy: interruptReason(), via: PERSIST_VIA.LOOP_EXIT})
            return 'aborted'
        }

        /**
         * 退出方式只有在这里才可知（必须在 aborted 提前 return 之后判，否则一次正常打断会被报成异常退出）：
         * `exhausted` 表示循环是被 maxIterations 掐断的，而每一轮 `continue` 都执行过 reset
         * （`answerContent` 已清空），于是落库 answer 为空、progress 仍是 `finish`
         * ——即 §2E-3 的现网缺陷（v1.6 与 v1.13 各复现一次，`test/services/core/llmLoopStream.test.js` 已能离线复现）。
         */
        loopExit = loopExitReason({broke: loopBroke, iterationCount, maxIterations})
        if (loopExit !== 'break') {
            tlog.warn(`主循环非正常退出: reason=${loopExit}, iterationCount=${iterationCount}/${maxIterations}, 末段answerLen=${answerContent.length}, answerList段数=${answerList.length}`)
        }

        /**
         * §2E-3 修法第 1 条：**到顶不清空**。
         * 打满时补一次不带工具的收尾调用，让模型基于已取回的工具结果给出结论，
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
         * 收尾调用被打断 ⇒ 同样是终态：把已保留的正文落成 abort 就结束这一轮。
         * 少写这一段，它会继续走 `exhaustedFallback`——那套逻辑解释的是"循环到顶"，
         * 与"被打断"是两回事。**早停必须在每一个上游调用点就地收尾，漏一个点就漏一类损失。**
         */
        if (finalizeInterrupted) {
            /** 收尾调用被打断：损失的是"基于已查到的信息给结论"那一次，与前两处都不同 */
            await persistTurn('abort', null, {interruptedBy: interruptReason(), via: PERSIST_VIA.FINALIZE_INTERRUPTED})
            return 'aborted'
        }

        /**
         * PR-M B2 完成性反问：只在开了 `finalize.selfCheck`、且计划仍有未结项时才可能触发（判据在
         * `decideCompletionSelfCheck`：`exhausted` 交回 finalization、没计划/没正文/中断都不触发）。
         * 位置是算过的：在"收尾被打断已 abort 返回"之后（别对半截 abort 再反问），
         * 在 `exhaustedFallback` 之前（补充要并进最终答案、不能落进空答案兜底）。
         * 开关关 ⇒ 整段不执行 ⇒ 现有退出路径逐字不变。
         */
        if (config.finalize?.selfCheck === true) {
            const sc = decideCompletionSelfCheck({
                plan: currentPlan,
                loopExit,
                hasAnswer: Boolean(answerContent),
                aborted: false,
                selfCheckEnabled: true,
            })
            if (sc.action === 'self-check') {
                await runSelfCheckCall()
            }
        }

        /**
         * §2E-3 修法第 2 条：**空答案不得记 `finish`**。
         * 收尾调用也没拿到正文时，把被 reset 抹掉的分段保住（能救多少救多少）并附上可读原因，
         * progress 记 `error`——`MessageProgressEnum` 里没有 truncated，也不为此扩枚举（会波及 schema 校验与前端分派）。
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
         * **`answer` 段是最终正文的权威计数**：即使刚补过收尾调用也要封这一段——
         * 收尾失败走兜底时 `answer` 是"部分正文 + 原因"，与 `finalize` 段的产出字数并不相等，
         * 少了这一段就没有任何地方记录"最终落库的答案有多长"。
         * 同一篇正文可能被 `finalize` 与 `answer` 各记一次，重复计数的风险在账本侧解决
         * （`createSegmentLedger.summary()` 只累加**有正文**的段，不计 `ref:'answer'` 的）。
         */
        segments.seal({
            kind: SEGMENT_KINDS.ANSWER,
            text: answerContent,
            startedAt: roundStartedAt,
            now: Date.now(),
        })

        /**
         * §14 观测先行（G-6）：出"每 run 模型调用次数"与"每 run token 数"。
         * 主指标是**非缓存 token**（D41：`prompt_tokens - cached_tokens`，这部分全价），
         * 命中率只作为派生量看；上游没回 usage 时 `hasUsage:false`，绝不猜 0。
         * 告警口径是**严格大于上限**：打满但正常收尾不报（那是"活多"），超出上限才报（那才是"在打循环"）。
         */
        const tailSnap = usageSnapshot()
        if (tailSnap.alert.level !== 'ok') {
            tlog.warn(`模型调用次数告警: level=${tailSnap.alert.level}, modelCalls=${modelCalls}, warnAt=${tailSnap.alert.warnAt}, `
                + `maxIterations=${maxIterations}, loopExit=${loopExit}, conversationCode=${conversationCode}, messageCode=${messageCode}`)
        }
        if (!tailSnap.metrics.hasUsage) {
            /** 这条必须单独存在：账本没数据时，"0 token" 与"没读到 usage"是两种完全不同的故障 */
            tlog.warn(`本轮未取到 usage（上游未回传或帧序异常）: conversationCode=${conversationCode}, modelCalls=${modelCalls}`)
        }

        let answerTokens = calcTextTokenCount(answerContent + answerReasoning, tokenizerOptions.tokenizer)
        await persistTurn(fb.progress, null, {via: PERSIST_VIA.NORMAL})

        /** 缓存只在真正完成时写：兜底文案进缓存等于把一次失败固化 90 天 */
        if (cacheEligible && fb.progress === 'finish') {
            /*缓存大模型回答*/
            /**
             * 缓存是附属能力：它失败不该让一整轮已经落库、已经流完的回答对外变成 error
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
         * 或客户端断开引发的 AbortError）就整段跳过 persistTurn，那一轮除了半截 SSE 什么都不留（§2E-2 第 2 条）。
         * 现在**先落库再决定对外形态**：中断仍走 abort 语义（客户端断开不是故障，
         * 记成 error 会让监控的错误率被用户行为污染）；真异常把原始错误继续抛给路由，由它下发 event:error。
         */
        const turnErr = describeError(e)
        tlog.error(`主循环异常: kind=${turnErr.kind}, status=${turnErr.status ?? '-'}, message=${turnErr.message.slice(0, 300)}`)
        const errProgress = turnErr.kind === 'abort' ? 'abort' : 'error'
        if (!persisted) {
            try {
                /**
                 * 错误路径也要说清"是谁打断的"（2026-11-12 修的漏点）。
                 * 此前这里只带 `via`，于是 SDK 抛回的 AbortError（客户端掐流）在档案里落成
                 * `unspecified`，而 `client-disconnect` 那一类永远看不到它——
                 * 用 `interruptedBy` 统计"用户主动打断"因此**少算这一类**（实测 dev 有 2 行）。
                 * 归因函数与其他四个中断路径**完全同一个**，不是在这里新造一套判断：
                 * `isClosing()` 为真就是发版拆连接（process-lost），否则是客户端断开。
                 */
                await persistTurn(errProgress, `${turnErr.kind}:${turnErr.message}`, {via: PERSIST_VIA.ERROR, ...(errProgress === 'abort' ? {interruptedBy: interruptReason()} : {})})
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
    /**
     * 形状探测器。
     *
     * H1 之后每条 trace 都出自 `buildToolCallTraceEntry`，**缺 `argsChars` 就等于有写入路径绕过了它**——
     * 2026-11-12 在 cw2pc 出现过一条只有 `{id, name, result}` 的记录，当时运行的代码（文件哈希核对过）
     * 在两处出口都带着展开，四轮复现全是六键，我没解释成它为什么，也不打算靠"以后再点一次"来守它。
     * 所以这里让档案自己报告，而且是**两条通道**：日志给人看（只写标识符与计数：`messageCode`、
     * `writtenBy`、条目数、`tool_call_id`），档案里再落一个计数（见下面 extInfo 的 `traceShapeGaps`）——
     * 后者不依赖日志级别，生产把 `debug` 关掉时探测器仍然说话。两处都不写任何正文，
     * 这条线的外泄边界跟工具结果全文一样严格。
     */
    const traceShapeGaps = findTraceShapeGaps(options.toolCalls)
    if (traceShapeGaps.length) {
        logger.warn(`trace 形状缺入参声明 messageCode=${messageCode} writtenBy=${options.writtenBy || '-'} `
            + `条目=${(options.toolCalls || []).length} 缺=${traceShapeGaps.length} ids=${traceShapeGaps.join(',').slice(0, 160)}`)
    }
    /**
     * 「这一轮允不允许用答案缓存、按什么键分组」的落档值。
     * 归一必须发生在**这里（唯一出口）**而不是各个调用点：缓存命中支与 `persistTurn` 两支都调 `saveMessage`，
     * 写在上面任何一处都会缺一支——那正是 2026-11-13 那两个键全库 0 行的成因之一（另一个成因是压根没进白名单）。
     */
    const cacheIntent = cacheIntentForArchive(options)
    /**
     * PR-G 批二b（方案 A）：终态整行写回**之前**，认领式删除本轮的 processing 中途行。
     * 为什么不是把 add 换成 upsert——`BaseDac.upsert` 的 attrOpen 递归会把 extInfo 展开成
     * 点路径做**部分合并**、跳过 null 字段、还绕开 mongoose 校验；中途行只带开局的最小字段，
     * 部分合并会让"终态没写的键"带着中途残值活下来。删+插保持全站终态写法只有一种
     * （`new Model().save()` 全量校验），代价仅是一次额外删除。
     * 删除失败不拦终态：行留在 processing 由 R1 翻转支兜底（见 abandonedBackfill）。
     * 删回来的行只用来**继承开局时刻**：提问气泡按 insertTime 排位，终态补写不许把本轮甩到会话尾部。
     */
    let startedRow = null
    try {
        startedRow = await messageDac.claimProcessing(messageCode)
    } catch (e) {
        logger.warn(`认领中途行失败（终态照常写，R1 兜底）messageCode=${messageCode}: ${String(e?.message || e).slice(0, 160)}`)
    }
    await messageDac.add({
        ...(startedRow?.insertTime ? {insertTime: startedRow.insertTime} : {}),
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
            /** §2E-3：循环退出方式（break/exhausted/…）与是否做过无工具收尾补落，空答案从此可解释、可统计 */
            loopExit: options.loopExit,
            forcedFinal: options.forcedFinal,
            /** PR-B：过程分段与它的体积摘要（丢过段、留存多少字） */
            segments: options.segments,
            segmentSummary: options.segmentSummary,
            /** §14/G-6：本 run 的模型用量与调用次数（非缓存 token 为主），逐条下钻用 */
            usage: options.usage,
            skills: options.skills,
            contextUsage: options.contextUsage,
            sources: options.sources,
            toolCalls: options.toolCalls,
            recallStats: options.recallStats,
            toolOverflows: options.toolOverflows,
            /**
             * 形状探测结果**必须同时走数据通道**，不能只走日志。
             * 理由很具体：app logger 的根级别是 `debug ? 'trace' : 'error'`，而 dev/cw2pc 目前
             * 都没设 env 覆盖（默认 `debug: true`，所以 warn 现在看得见）——**一旦某个部署把
             * `debug=false`（生产就是），`logger.warn` 会被根级别整条吃掉**，探测器变成哑巴而没人知道。
             * 这正是本方案反复点名的"静默开关"形状，所以计数恒定落库：0 也是一个被量过的事实；
             * 旧行没有这个键 ⇒ 那是探测器存在之前写的，不与"0 个缺口"混读。
             */
            traceShapeGaps: traceShapeGaps.length,
            /**
             * 打断来源（`client-disconnect` / `process-lost` / `unspecified`）。
             * 存进 extInfo 而不是新开顶层列：这一条是审计字段，读它的是我们不是前端；
             * 前端只需要 `progress:'abort'` 就能画出既有的"本轮回答已被中断，内容不完整"。
             */
            interruptedBy: options.interruptedBy,
            /** 写下这条档的路径（normal / early-stop / rescue / error / backfill / unattributed） */
            writtenBy: options.writtenBy,
            /**
             * P5/P3 的两个新键必须在这里也出现：`persistTurn` 那边算出来只是半成品，
             * 这份装配清单才是 extInfo 的**唯一出口**。
             * 2026-11-13 实测踩过：`runOverlap` 与 `regeneratedFrom` 在上游都写了、接线测试全绿，
             * 但库里两键都不存在——因为这里没列，而源码级守卫只看了一侧。
             * 现在由 `test/services/core/extInfoPassthrough.test.js` 把"两侧必须齐"钉住。
             */
            runOverlap: options.runOverlap,
            regeneratedFrom: options.regeneratedFrom,
            /**
             * 这两个是**请求侧的表态**，以前从不落档：2026-11-13 实测 dev 库 `message` 1490 行里，
             * 顶层有 `cache` 键 0 行、`extInfo.cache` 0 行、`extInfo.channelCacheKey` 0 行
             * （9 条重跑行与 400 条对照行也都是 0）——因为这份白名单没列它们。
             * 缺它们的后果不是"少两个字段"，而是**少一条排查口径**：今天只能从结果性字段
             * （顶层 `answerFromCache` + 账本 `modelCalls`）反推"命中没命中"，
             * 推不出"当时允不允许命中、按什么键分组"。
             * 值走 `cacheIntentForArchive` 归一：`false` 是"明确不允许"，`null` 才是"没有表态"。
             * 刻意**不进 `messageView`**：这两个键读的人是排障的我们，不是前端（同 `interruptedBy` 的先例）。
             */
            cache: cacheIntent.cache,
            channelCacheKey: cacheIntent.channelCacheKey,
            /** D44 留痕：思考开关的实际生效形态（`thinkingMode.js` 给），缺决策时为 null */
            thinking: options.thinking,
            /**
             * PR-M：本轮计划（`planForPersistence` 归一后给，无计划为 null）。
             * 与 cache/channelCacheKey 同属"落档但不进视图"的审计字段——
             * 读它的是下一轮的 recitation 种子与排查的我们，前端没有消费方，进视图只会多一个没人读的承诺。
             */
            plan: options.plan,
            /** PR-D commit 2：注入过的插话清单（来源与去向的裁定见 persistTurn 处注释） */
            steerings: options.steerings,
            /**
             * P-19：ask 回执档案面。与 steerings 同族——**saveMessage 的 extInfo 字面量是落库白名单，
             * 生产侧（persistTurn）加了键而这里没加 = 静默丢**（2026-11-15 实机第一跑就丢给我看了，
             * 守卫用例见 test/daos…/artifactSchema 同族的锚法：这条链的每一次"加字段"都要动两处）。
             */
            awaitings: options.awaitings,
            /**
             * 2026-11-15 守卫上线即钓出的两条**存量同类漏点**（不是本刀引入的）：
             * `error`（异常归因 kind:message，生产侧注释写着"正常路径为 null"——但白名单没它，
             * 档案里从来就没有过这个键）与 `upstream`（PR-0.5 的重试/换档现场，同上）。
             * 与 2026-11-13 cache 两键 0 行的成因一模一样；这次由两截链守卫（llmChatExtInfoWhitelist）
             * 在它们造成第三个事故前抓出来。
             */
            error: options.error,
            upstream: options.upstream,
            /** PR-I 门观察账落库位（两截链守卫 llmChatExtInfoWhitelist 盯这条的存在性） */
            gate: options.gate,
        },
        messageTokens: options.messageTokens,
        answerTokens: options.answerTokens,
        tokenizerVersion: options.tokenizerVersion,
        attachments: options.attachments,
        answerAttachments: options.answerAttachments,
    })
}

