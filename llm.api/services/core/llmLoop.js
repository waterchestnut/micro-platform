/**
 * @fileOverview execChat 主循环的纯决策逻辑
 * @module services/core/llmLoop
 * @description
 * `execChat` 是 700 行、零单测的函数（`docs/session-run-plan.md` §2.10），而 PR-A/B/C/D/E 全都要改它。
 * 本模块把其中**不需要 OpenAI / 数据库 / MCP 就能判定**的部分抽出来，先装上测试，
 * 再让 `llmChat.js` 反过来消费它——这样后续重构有一张真正的网，而不是靠改完手点。
 *
 * 三条纪律：
 * 1. **零副作用、零 IO 依赖**：判定所需的谓词（哪些是记忆/溢出/代码工具）由调用方注入，
 *    否则本模块会被 `mcp/`、`memory/`、`sandbox/` 的模块级连接拖住，又变成离线不可测。
 *    唯一允许的 import 是同样纯的判据模块（`./upstreamBreaker.js`：不建连接、不读 env、不碰时钟以外的事物）。
 * 2. **行为必须与抽出前逐字一致**：包括"没有 index 的 tool_call 增量被丢弃"这类看起来像 bug
 *    的现状——**先钉住现状，再在 PR-A 里决定是否改**，不要在抽取的同一刀里夹带修复。
 * 3. 新增的判定表（如断开阶段策略）**只定义不接线**，等 PR-C 用到时再接，避免提前改行为。
 */

import {breakerCountsFailure} from './upstreamBreaker.js'

/* ---------- 协议协商（对应 llmChat.js 的 clientProtocol / emitToolResults） ---------- */

/**
 * @description 协商事件协议版本
 * @param {Object} options 请求 options
 * @returns {{protocol: Number, emitToolResults: Boolean}}
 */
export function resolveProtocol(options = {}) {
    const requested = Number(options.protocol)
    const protocol = requested >= 3 ? 3 : (requested >= 2 ? 2 : 1)
    return {
        protocol,
        /** 协议 2 的客户端按事件名分派，因此默认下发工具结果；协议 1 需显式开启 */
        emitToolResults: protocol >= 2 || !!options.streamToolResults,
        /** 段事件（segment_start/segment_end）是协议 3 相对协议 2 的全部内容差异 */
        emitSegments: protocol >= 3,
    }
}

/* ---------- tool_calls 增量聚合（对应 llmChat.js:470-496） ---------- */

/**
 * @description 把一个流式 chunk 里的 tool_calls 增量并入累积数组
 * @param {Object[]} toolCalls 累积数组（原地改，与抽取前一致）
 * @param {Object[]} deltas chunk 里的 delta.tool_calls
 * @returns {{toolCalls: Object[], touched: Boolean}} touched 表示本 chunk 是否出现 tool_calls
 */
export function accumulateToolCalls(toolCalls = [], deltas) {
    if (!deltas) {
        return {toolCalls, touched: false}
    }
    for (const d of deltas) {
        /** 现状：没有 index 的增量直接丢弃（OpenAI 兼容层都带 index，缺 index 说明上游不合规） */
        if (d.index === undefined) {
            continue
        }
        while (toolCalls.length <= d.index) {
            toolCalls.push({id: '', function: {name: '', arguments: ''}, type: 'function'})
        }
        const cur = toolCalls[d.index]
        if (d.id) {
            cur.id = d.id
        }
        if (d.function?.name) {
            cur.function.name = cur.function.name + d.function.name
        }
        if (d.function?.arguments) {
            cur.function.arguments = cur.function.arguments + d.function.arguments
        }
    }
    return {toolCalls, touched: true}
}

/**
 * @description 丢弃空壳工具调用（对应 llmChat.js:538 的 filter）
 * @param {Object[]} toolCalls 累积结果
 * @returns {Object[]} 只保留 id 与函数名都齐的调用
 */
export function pruneToolCalls(toolCalls = []) {
    return toolCalls.filter(tc => tc?.id && tc?.function?.name)
}

/**
 * @description 组装进 messages 的 assistant 工具调用消息（对应 llmChat.js:543-547）
 * @param {Object[]} toolCalls 已 prune 的调用
 * @returns {Object} assistant 消息
 */
export function buildAssistantToolCallMessage(toolCalls) {
    /** 工具调用时内容可能为空，必须显式 null 而不是省略，否则部分兼容层会把它当"补充上一句" */
    return {role: 'assistant', content: null, tool_calls: toolCalls}
}

/* ---------- usage 归一与累加（§14 自有账本的数据源） ---------- */

/**
 * @description 空的 usage 记录（字段口径固定，缺项补 0，便于跨轮累加与写账本）
 * @returns {{promptTokens: Number, completionTokens: Number, totalTokens: Number, cachedTokens: Number, reasoningTokens: Number, reported: Boolean}} 零值 usage
 */
export function createEmptyUsage() {
    /** `reported:false` 必须是显式字段而不是缺省：账本要能区分"上游回了 0"与"上游没回" */
    return {promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0, reported: false}
}

/**
 * @description 把上游的 usage（snake_case，OpenAI 兼容层形态）折成内部口径
 * @param {Object} [raw] 一帧里的 `chunk.usage`
 * @returns {{promptTokens: Number, completionTokens: Number, totalTokens: Number, cachedTokens: Number, reasoningTokens: Number}} 归一后的 usage
 * @description
 * 两条必须是这样的规则：
 * 1. **`cachedTokens` 只能从 `prompt_tokens_details.cached_tokens` 取**，不能用 `total - completion` 反推；
 *    反推在隐式缓存下会把"没命中"算成"命中"，成本口径直接失真（D41 的主指标就是 `prompt - cached`）。
 * 2. **取不到就省略不猜**（§14）：字段缺失记 0，但 `reported` 标记为 false，
 *    账本与告警都要能区分"真的 0"和"上游没回"。
 */
export function normalizeUsage(raw) {
    const src = raw || {}
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0)
    return {
        promptTokens: num(src.prompt_tokens ?? src.input_tokens),
        completionTokens: num(src.completion_tokens ?? src.output_tokens),
        totalTokens: num(src.total_tokens),
        cachedTokens: num(src.prompt_tokens_details?.cached_tokens ?? src.cached_tokens),
        reasoningTokens: num(src.completion_tokens_details?.reasoning_tokens ?? src.reasoning_tokens),
        reported: !!(src.prompt_tokens || src.completion_tokens || src.total_tokens),
    }
}

/**
 * @description 累加两次 usage（多轮迭代与收尾调用的量要合并成"每 run"的量）
 * @param {Object} a 累计值
 * @param {Object} b 本次值
 * @returns {Object} 合并后的 usage
 */
export function addUsage(a, b) {
    const x = a || createEmptyUsage()
    const y = b || createEmptyUsage()
    return {
        promptTokens: (x.promptTokens || 0) + (y.promptTokens || 0),
        completionTokens: (x.completionTokens || 0) + (y.completionTokens || 0),
        totalTokens: (x.totalTokens || 0) + (y.totalTokens || 0),
        cachedTokens: (x.cachedTokens || 0) + (y.cachedTokens || 0),
        reasoningTokens: (x.reasoningTokens || 0) + (y.reasoningTokens || 0),
        reported: !!(x.reported || y.reported),
    }
}

/**
 * @description 算出账本与告警要用的派生量
 * @param {Object} usage 归一后的 usage
 * @param {Number} [modelCalls] 本 run 的模型调用次数（含无工具收尾补落）
 * @returns {{billablePromptTokens: Number, nonCachedRatio: Number|null, cacheReadTokens: Number, modelCalls: Number, hasUsage: Boolean}} 派生指标
 * @description
 * `billablePromptTokens = promptTokens - cachedTokens`（D41：主指标是**非缓存 token**，不是命中率）。
 * 上游没回 usage 时返回 `hasUsage:false` 且比例给 `null` —— **不能给 0**，
 * 0 会被看板读成"全部命中缓存"，那是最容易被当成好消息的错法。
 */
export function deriveUsageMetrics(usage, modelCalls = 0) {
    const u = usage || createEmptyUsage()
    const billablePromptTokens = Math.max(0, (u.promptTokens || 0) - (u.cachedTokens || 0))
    const hasUsage = !!u.reported && (u.promptTokens || 0) > 0
    return {
        billablePromptTokens,
        cacheReadTokens: u.cachedTokens || 0,
        nonCachedRatio: hasUsage ? Number((billablePromptTokens / u.promptTokens).toFixed(4)) : null,
        modelCalls,
        hasUsage,
    }
}

/**
 * @description 每 run 模型调用次数的告警判定（失控循环的第一个可见症状，§14）
 * @param {Object} state 现场
 * @param {Number} state.modelCalls 本 run 的模型调用次数
 * @param {Number} state.maxIterations 迭代上限
 * @param {Number} [state.warnAt] 告警阈值；缺省 = `maxIterations`（判定用**严格大于**）
 * @param {Number} [state.hardAt] 熔断阈值（交给上层拒绝继续，本函数只判定）
 * @returns {{level: 'ok'|'warn'|'critical', overWarn: Boolean, overHard: Boolean, modelCalls: Number, warnAt: Number}} 判定结果
 * @description
 * **阈值为什么是"严格大于上限"**：一次打满 6 轮但正常收尾（`loopExit:'break'`）的运行，
 * 是"这轮活多"，不是"在打循环"——把它报成 warn 会让告警第一天就变成噪声，
 * 而噪声告警等于没有告警（同一批实测里 `droppedCount` 全程为 0 也是这个教训）。
 * 真正的信号是**超出了上限**（需要额外补收尾调用，或显式越过 `hardAt`）。
 * "打满"本身另有出口：`loopExit==='exhausted'` 在主循环里已经单独 warn 了，这里不重复报。
 */
export function usageCallAlert({modelCalls = 0, maxIterations = 6, warnAt = null, hardAt = null} = {}) {
    /** **严格大于**上限才算异常：等于上限就是"打满但按规矩收尾" */
    const warn = Number.isFinite(Number(warnAt)) && Number(warnAt) > 0 ? Number(warnAt) : maxIterations
    const hard = Number.isFinite(Number(hardAt)) && Number(hardAt) > 0 ? Number(hardAt) : null
    const overWarn = modelCalls > warn
    const overHard = hard !== null && modelCalls >= hard
    return {
        level: overHard ? 'critical' : (overWarn ? 'warn' : 'ok'),
        overWarn,
        overHard,
        modelCalls,
        warnAt: warn,
    }
}

/* ---------- 单轮流式响应消费（对应 llmChat.js:457-480） ---------- */

/**
 * @description 消费一整轮流式响应，聚合正文、推理与工具调用增量
 * @param {AsyncIterable<Object>|Object[]} chunks openai 返回的流（或假 stream）
 * @param {Object} [handlers]
 * @param {Function} [handlers.onDelta] 每个含正文/推理的增量回调 `(delta, snapshot)`；
 *        调用时机与抽取前逐字一致（累加之后、同一 chunk 内），因此 SSE 顺序不变
 * @param {Function} [handlers.shouldStop] 每帧前询问一次"还要不要继续"，返回真值即早停；
 *        返回值会原样出现在结果的 `stopped` 字段里。**不给这个回调时行为与抽取前逐字一致**
 * @returns {Promise<{content: String, reasoning: String, toolCalls: Object[], receivedToolCall: Boolean, finishReason: String|null, chunkCount: Number, deltaCount: Number, usage: Object, usageChunks: Number, stopped: String|null}>}
 *
 * 现状（本函数原样保留，不在这一刀改）：
 * - `chunk.choices[0]` 不做空值防护 ⇒ chunk 缺 `choices` 字段会抛错；`execChat` 当时**没有 try/catch**，
 *   异常直接冒到上层（已在 PR-A 补上）；`choices: []`（末帧 usage）是安全的，且 usage 就在这一帧上取。
 * - 判定"本轮是否要求调用工具"用的是 `delta.tool_calls` **字段是否存在**，不是数组是否非空
 *   ⇒ `tool_calls: []` 也会置 receivedToolCall=true。
 * - `shouldStop` 是**这一刀新加的**（其余行为逐字不变）：它在**每帧之前**问一次，
 *   命中就带着已累计的正文早退，`stopped` 里放原因。
 *   为什么必须落在帧间而不是调用方自己判：调用方的判点全在 drain 返回之后，
 *   而一次生成可以持续一分多钟——那段窗口里断开既不停止生成也不落档（实测见 v1.38）。
 */
export async function drainAssistantStream(chunks, {onDelta, shouldStop} = {}) {
    let content = ''
    let reasoning = ''
    let toolCalls = []
    let receivedToolCall = false
    let finishReason = null
    let chunkCount = 0
    let deltaCount = 0
    let usage = createEmptyUsage()
    let usageChunks = 0
    let stopped = null

    for await (const chunk of chunks) {
        chunkCount++
        /**
         * **每帧先看该不该停**。这一行是 2026-11-10 取证换来的：
         * 旧版这里没有任何停止判据，`execChat` 的 `signal.aborted` 检查都在 drain **返回之后**
         * （`llmChat.js:888`、`:1138`），所以一旦进入流式生成，
         * "客户端已断开"既拦不住生成、也到不了 `persistTurn` ——实测 abort() 之后还送了
         * 45 秒 / 10,772 字，最后档案无行、账本停 `processing`。
         * 判据由调用方给（`shouldStop`），这里不自己读全局状态：纯函数才能离线测。
         */
        if (shouldStop) {
            const why = await shouldStop()
            if (why) {
                stopped = why
                break
            }
        }
        /**
         * usage 帧必须在 `choices` 判空**之前**取：OpenAI 兼容层的最后一帧是 `{choices: [], usage: {...}}`，
         * 顺序写反就等于永远读不到 token 数（这正是 §14 说的"账本没有数据来源"的代码根因，
         * 而上游 P-1 实测确认 usage 一直都在，是我们丢了）。
         */
        if (chunk.usage) {
            usage = addUsage(usage, normalizeUsage(chunk.usage))
            usageChunks++
        }
        const choice = chunk.choices[0]
        if (!choice) {
            continue
        }
        if (choice.finish_reason) {
            finishReason = choice.finish_reason
        }
        const delta = choice.delta || {}

        if (delta.content || delta.reasoning_content) {
            content += delta.content || ''
            reasoning += delta.reasoning_content || ''
            deltaCount++
            /** 传原始 delta（不是拆分后的字段）：抽取前的 payload 是 `{...delta}` 展开，可能带 tool_calls 等额外键 */
            /**
             * snapshot 只给**基元值**，不给 toolCalls 的引用：
             * 数组是原地增长的，把引用交给回调会让回调看到的"当时的值"其实是"最后的值"，是个静默的坑。
             * 需要工具调用细节的调用方请用返回值的 toolCalls。
             */
            if (onDelta) {
                await onDelta(delta, {content, reasoning, toolCallCount: toolCalls.length})
            }
        }

        if (delta.tool_calls) {
            const acc = accumulateToolCalls(toolCalls, delta.tool_calls)
            toolCalls = acc.toolCalls
            receivedToolCall = acc.touched || receivedToolCall
        }
    }

    return {content, reasoning, toolCalls, receivedToolCall, finishReason, chunkCount, deltaCount, usage, usageChunks, stopped}
}

/* ---------- 迭代走向决策（对应 llmChat.js:493-645） ---------- */

/**
 * @description 一轮响应消费完之后的分支决策；抽取前是两个互斥的 if
 * @param {Object} state 本轮现场
 * @param {Boolean} state.receivedToolCall 是否出现过 tool_calls 字段
 * @param {Number} state.rawToolCallCount prune 前的条目数
 * @param {String} state.answerContent 本轮已累加的正文
 * @param {Object} state.skillContext 动态技能上下文（无则为假）
 * @returns {'skill-check'|'tool-round'|'final'} skill-check 未必 continue（未选中技能时同样落到 final）；
 *          tool-round 在 prune 后可能为空壳，也会落到 final——与抽取前一致
 */
export function iterationDecision({receivedToolCall = false, rawToolCallCount = 0, answerContent = '', skillContext = null} = {}) {
    if (!receivedToolCall && answerContent && skillContext) {
        return 'skill-check'
    }
    if (receivedToolCall && rawToolCallCount > 0) {
        return 'tool-round'
    }
    return 'final'
}

/**
 * @description while 循环退出方式——这是 §2E-3 空答案 bug 的**唯一可观测信号**
 * @param {Object} state
 * @param {Boolean} state.broke 是否由 break 正常退出
 * @param {Number} state.iterationCount 实际迭代次数
 * @param {Number} state.maxIterations 上限（现为硬编码 6）
 * @returns {'break'|'exhausted'|'no-iterations'|'unknown'}
 *
 * `exhausted` 意味着循环是**被上限掐断**的：上一轮以工具结果 `continue` 收尾，
 * 而每次 continue 都会把 `answerContent` 清空（reset 语义），所以落库的 answer 是空串、
 * progress 却仍是 `finish`。抽取前代码无法区分这两种退出，因此该 bug 只会以"模型没回答"的形式暴露。
 */
export function loopExitReason({broke = false, iterationCount = 0, maxIterations = 6} = {}) {
    if (broke) {
        return 'break'
    }
    if (iterationCount === 0) {
        return 'no-iterations'
    }
    if (iterationCount >= maxIterations) {
        return 'exhausted'
    }
    /**
     * 走到这里说明 while 是从 `options.signal.aborted` 那条早退分支离开的。
     * **这句原来写的是"理论上不可达"——v1.72 的 dev 实测把它证伪了**：
     * 断开落在工具批之后那一轮，档案里 `progress:abort` 且 `loopExit:unknown`，
     * 也就是"不可达"的那个值确实落了库。留下这个值，但补齐规则改由
     * `exitReasonForPersist` 在落库那一点统一处理（判据只放一份）。
     */
    return 'unknown'
}

/**
 * @description 落库时的退出原因：`abort` 路径不许带着 `unknown` 进档案
 * @param {Object} p 现场
 * @param {String} p.progress 本次落库的 progress（finish/abort/error…）
 * @param {String} p.loopExit 循环自己算出的退出原因（可能是 'unknown'）
 * @param {String} [p.via] 落库来源（`PERSIST_VIA` 之一）
 * @param {Boolean} [p.closing] 进程是否已进入关闭序列
 * @returns {String} 要写进 `extInfo.loopExit` 的值
 *
 * 为什么必须在这里补，而不是在四个早退点各写一行 `loopExit = ...`：
 * `persistTurn` 是唯一一个"确定要落档"的地方，规则放四遍就会有四份漂移——
 * 而"这轮为什么没答完"这个问题恰恰需要**跨来源可比**（断开 / 发版 / 兜底各占多少）。
 * `unknown` 从此只剩一种含义：落库前循环确实没给出原因，且这里也能补出原因。
 */
export function exitReasonForPersist({progress, loopExit, via = '', closing = false} = {}) {
    if (progress !== 'abort') {
        /** 非 abort 的落库不动循环给的原因（包括它自己就是 'unknown' 的情形：那是另一条问题，不该在这里被掩盖） */
        return loopExit
    }
    if (loopExit && loopExit !== 'unknown') {
        return loopExit
    }
    const cause = closing ? 'shutdown' : 'aborted'
    return `${cause}:${via || 'unattributed'}`
}



/* ---------- 迭代预算的增量测量（PR-K1，实测后缩小的一刀） ---------- */

/**
 * @description 建一个上下文预算测量器：**只测新增消息**，不每轮全量重算
 * @param {Object} deps 依赖注入（保持本模块零依赖）
 * @param {Function} deps.measureOne 单条消息的 token 测量 `(message) => Number`
 * @param {Function} [deps.isRewritten] 判断"历史是否被就地改写过" `(messages) => Boolean`；返回 true 时全量重算
 * @returns {{total: Function, check: Function, invalidate: Function, stats: Function}} 测量器
 * @description
 * 为什么这是**等价**而不是近似：`calcMessagesTokenCount` 的实现是
 * `messages.reduce((sum, m) => sum + calcMessageTokenCount(m), 0)` ⇒ 整体值严格等于逐条值之和，
 * 所以"上一轮的整体值 + 本轮新增各条"与"本轮全量重算"必然相等。
 * 一旦有人把测量改成非可加的（例如按整段文本重新 encode，跨消息 BPE 合并会吃掉几个 token），
 * 这个等价就断了——所以 `isRewritten` 之外还必须保留 `invalidate()` 给改写型压缩用。
 *
 * 收益口径（v1.20 实测更正，见 §2.20 与探针 P-15）：dev 96 条带预算的样本里
 * **越界 0 次、最大 total/budget 仅 5.80%** ⇒ 每轮全量 `compactToBudget` 从未真正改写过任何消息，
 * 它留下的成本只是 tokenize 的 CPU：一轮 6 次迭代就是 6 次全量重算（O(n²)）。
 * 缓存与前缀稳定性收益为 **0**，别按那个立项。
 */
export function createBudgetMeter({measureOne, isRewritten = null} = {}) {
    let upTo = 0
    let total = 0
    let fullPasses = 0
    let deltaPasses = 0

    /**
     * @description 全量重算（首帧、或历史被改写过时）
     * @param {Object[]} messages 消息数组
     * @returns {Number} 全量 token
     */
    const recount = (messages) => {
        total = (messages || []).reduce((sum, m) => sum + Number(measureOne(m) || 0), 0)
        upTo = (messages || []).length
        fullPasses++
        return total
    }

    /**
     * @description 测量当前上下文总量
     * @param {Object[]} messages 消息数组（同一数组，长度只增不减才算追加式）
     * @returns {Number} token 总量
     */
    const check = (messages) => {
        const list = messages || []
        /** 首次测量（或数组被清空后重来）就是一次全量：别把它记成增量，否则 stats 会骗人说"没有全量成本" */
        if (upTo === 0 && list.length > 0) {
            return recount(list)
        }
        /** 数组变短说明上游重新装配过（新一轮、或压缩丢弃了消息），增量结果不可信 ⇒ 全量重算 */
        if (list.length < upTo) {
            return recount(list)
        }
        if (isRewritten && isRewritten(list)) {
            return recount(list)
        }
        for (let i = upTo; i < list.length; i++) {
            total += Number(measureOne(list[i]) || 0)
            deltaPasses++
        }
        upTo = list.length
        return total
    }

    return {
        check,
        /** 让下一次 check 强制全量重算：任何就地改写已有消息的动作之后都要调 */
        invalidate: () => {
            upTo = 0
            total = 0
        },
        total: () => total,
        /** 观测用：全量/增量的次数比，能直接看出这轮循环有没有退化成 O(n²) */
        stats: () => ({fullPasses, deltaPasses, measuredUpTo: upTo}),
    }
}

/* ---------- 异常归因（供 §2E-2 的 try/catch 使用） ---------- */

/**
 * @description 把上游异常折成可落库、可下发的文本与类别
 * @param {*} e 捕获到的异常（OpenAI SDK 的 APIError/AbortError、TypeError、字符串等都接受）
 * @returns {{kind: 'abort'|'api'|'unknown', message: String, status: Number|null}}
 * @description
 * `kind` 决定落库的 progress 与客户端收到哪个事件：**中断不是故障**，
 * 客户端断开/主动 stop 抛出的 AbortError 必须走 abort 语义（`event: abort`），
 * 否则一次正常打断会被记成 error，监控里的错误率会被用户行为污染。
 */
export function describeError(e) {
    if (!e) {
        return {kind: 'unknown', message: '未知错误', status: null}
    }
    const name = String(e.name || '')
    const raw = String(e.message || e)
    const status = Number(e.status) > 0 ? Number(e.status) : (Number(e.statusCode) > 0 ? Number(e.statusCode) : null)

    /**
     * 顺序很重要：TimeoutError 先判。
     * `AbortSignal.timeout()` 与部分 fetch 实现的超时消息里也带 "aborted"字样，
     * 若先按 abort 归类，"relay 挂了"就会被记成"用户主动打断"，错误率与打断率同时失真。
     */
    if (name === 'TimeoutError' || /timed?\s*out|timeout/i.test(raw)) {
        return {kind: 'api', message: raw.slice(0, 500), status}
    }
    if (name === 'AbortError' || /aborted|abort|user\s*cancelled|The\s*user\s*turned\s*the\s*connection/i.test(raw)) {
        return {kind: 'abort', message: raw.slice(0, 500), status}
    }
    /** OpenAI SDK 的 APIError/APIConnectionError/RateLimitError 等都带 type 或 status */
    if (status !== null || e instanceof Error || name.endsWith('Error')) {
        return {kind: 'api', message: raw.slice(0, 500), status}
    }
    return {kind: 'unknown', message: raw.slice(0, 500), status}
}

/**
 * @description 解析 429/503 的 `Retry-After`（秒或 HTTP 日期）成毫秒
 * @param {Object|Array|Function} headers SDK 的错误对象上带的是 `Headers`，形态各家不同，这里都兜一下
 * @returns {Number} 毫秒；拿不到就 0
 * @description
 * 上游明确告诉你"什么时候再来"时，它比任何本地猜测都准；但**必须夹在 `capMs` 之内**——
 * 不能因为上游说"300 秒后再试"就把一个在线请求挂在那儿，那不叫重试叫排队。
 */
export function parseRetryAfterMs(headers) {
    if (!headers) {
        return 0
    }
    let raw
    try {
        if (typeof headers.get === 'function') {
            raw = headers.get('retry-after') || headers.get('Retry-After')
        } else if (Array.isArray(headers)) {
            const hit = headers.find(([k]) => String(k).toLowerCase() === 'retry-after')
            raw = hit ? hit[1] : undefined
        } else {
            raw = headers['retry-after'] ?? headers['Retry-After']
        }
    } catch (e) {
        return 0
    }
    if (raw === undefined || raw === null || raw === '') {
        return 0
    }
    const secs = Number(raw)
    if (Number.isFinite(secs)) {
        return Math.max(0, Math.round(secs * 1000))
    }
    const at = Date.parse(String(raw))
    return Number.isNaN(at) ? 0 : Math.max(0, at - Date.now())
}

/* ---------- 迭代上限：配置化（§2E-3 修法第 3 条） ---------- */

/** 兜底上限：与抽取前的硬编码值一致，保证不配置时行为不变 */
export const DEFAULT_MAX_ITERATIONS = 6

/** 允许的上限天花板：请求级/频道级配置都不能突破，防止一次会话把上游打爆 */
export const MAX_ITERATIONS_CEILING = 20

/**
 * @description 解析本轮的工具迭代上限（原先是硬编码 6）
 * @param {Object} [src] 各级配置，按优先级从前往后取第一个有效值
 * @param {Number|String} [src.requestValue] 请求级 `options.maxIterations`
 * @param {Number|String} [src.channelValue] 频道级 `channelConfig.maxIterations`
 * @param {Number|String} [src.configValue] 全局级 `config.limits.maxIterations`
 * @param {Number|String} [src.fallback] 兜底值，默认 6
 * @returns {Number} 1..20 的整数
 */
export function resolveMaxIterations({requestValue, channelValue, configValue, fallback = DEFAULT_MAX_ITERATIONS} = {}) {
    for (const raw of [requestValue, channelValue, configValue, fallback]) {
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 1) {
            return Math.min(Math.floor(n), MAX_ITERATIONS_CEILING)
        }
    }
    return DEFAULT_MAX_ITERATIONS
}

/* ---------- 上限打满后的收尾补救（§2E-3 修法第 1、2 条） ---------- */

/** 收尾调用里追加的用户提示：说明为什么到此为止，并要求直接给结论 */
export const FINALIZE_HINT_TEXT = '工具调用次数已达上限，请不要再调用工具，直接基于以上结果给出结论。'

/** 收尾调用也失败时，落库与下发给用户的可读原因 */
export const EXHAUSTED_NOTICE_TEXT = '（本轮工具调用达到上限，未能得出完整结论；以上为已获得的部分内容，请缩小问题范围后重试。）'

/**
 * @description 决定循环异常退出后要不要补一次"无工具收尾调用"
 * @param {Object} [state]
 * @param {String} [state.loopExit] `loopExitReason` 的结果
 * @param {String} [state.answerContent] 末段已累加的正文（`exhausted` 时必然为空）
 * @param {Boolean} [state.finalizeDisabled] 配置关闭补救（`config.limits.maxIterationsFinalize === false`）
 * @param {Boolean} [state.aborted] 本轮已被中断（中断不该再花钱补调用）
 * @returns {{action: 'none'|'force-final', reason: String}}
 */
export function finalizationDecision({loopExit = 'break', answerContent = '', finalizeDisabled = false, aborted = false} = {}) {
    if (loopExit !== 'exhausted') {
        return {action: 'none', reason: 'normal-exit'}
    }
    if (aborted) {
        return {action: 'none', reason: 'aborted'}
    }
    if (answerContent) {
        /** 上限打满但末段仍有正文：已经是可用答案，不再补调用 */
        return {action: 'none', reason: 'has-answer'}
    }
    if (finalizeDisabled) {
        return {action: 'none', reason: 'disabled'}
    }
    return {action: 'force-final', reason: 'exhausted-empty'}
}

/**
 * @description 构造"无工具收尾调用"的请求体
 * @param {Object} createBody 主循环在用的请求体（不被修改）
 * @param {Object[]} messages 已含全部工具结果的消息数组（不被修改）
 * @param {String} [hint] 追加的用户提示
 * @returns {Object} 去掉 tools/tool_choice、末尾追加一条 user 提示的新请求体
 */
export function buildFinalizeBody(createBody = {}, messages = [], hint = FINALIZE_HINT_TEXT) {
    const body = {...createBody, messages: [...messages, {role: 'user', content: hint}], stream: true}
    delete body.tools
    delete body.tool_choice
    return body
}

/**
 * @description 收尾补救之后（或补救被关闭时）决定落库正文与 progress
 * @param {Object} [state]
 * @param {String} [state.loopExit] 循环退出方式
 * @param {String} [state.answerContent] 收尾补落后仍为空的末段正文
 * @param {String[]} [state.answerList] 被 reset 抹掉的历史分段
 * @param {String} [state.notice] 可读原因
 * @returns {{answer: String, progress: 'finish'|'error', usedPartial: Boolean, notice: String}}
 * @description
 * `progress` 的口径：**空答案绝不能记 `finish`**。这是 §2E-3 的用户可见症状（一条空白"完成"的回答）。
 * 有历史分段时把它们作为部分内容保住（修法第 1 条"到顶时不得清空"），同时把 progress 记成 `error`，
 * 让前端与监控都能看到"这一轮没成功"。不新增 `truncated` 枚举值：
 * `MessageProgressEnum` 被 schema 的 enum 校验引用，扩枚举会波及 mongo 校验与前端分派，收益不抵风险。
 */
export function exhaustedFallback({loopExit = 'break', answerContent = '', answerList = [], notice = EXHAUSTED_NOTICE_TEXT} = {}) {
    if (loopExit !== 'exhausted') {
        return {answer: answerContent, progress: 'finish', usedPartial: false, notice: ''}
    }
    if (answerContent) {
        return {answer: answerContent, progress: 'finish', usedPartial: false, notice: ''}
    }
    const partial = (answerList || []).filter(Boolean).join('')
    if (partial) {
        return {answer: partial + notice, progress: 'error', usedPartial: true, notice}
    }
    return {answer: notice, progress: 'error', usedPartial: false, notice}
}

/* ---------- 工具分派分类（对应 llmChat.js:551-555） ---------- */

/**
 * @description 按谓词把工具调用分派到四类执行通道
 * @param {Object[]} toolCalls 已 prune 的调用
 * @param {Object} predicates 由调用方注入，保持本模块零依赖
 * @param {Function} predicates.isMemoryTool 记忆工具判定
 * @param {Function} predicates.isOverflowTool 溢出取回工具判定
 * @param {Function} predicates.isCodeTool 沙箱代码工具判定
 * @returns {{memoryCalls: Object[], overflowCalls: Object[], codeCalls: Object[], otherCalls: Object[]}}
 */
export function classifyToolCalls(toolCalls = [], {isMemoryTool, isOverflowTool, isCodeTool, isPlanTool, isArtifactTool} = {}) {
    const isMem = typeof isMemoryTool === 'function' ? isMemoryTool : () => false
    const isOvf = typeof isOverflowTool === 'function' ? isOverflowTool : () => false
    const isCode = typeof isCodeTool === 'function' ? isCodeTool : () => false
    /** update_plan（PR-M）：不传谓词就恒 false ⇒ 行为与加它之前逐字一致（默认关时 llmChat 也不会走到） */
    const isPlan = typeof isPlanTool === 'function' ? isPlanTool : () => false
    /** save_artifact/read_artifact（PR-H2）：同款兼容——不传谓词恒 false，otherCalls 取反串同样带上它 */
    const isArtifact = typeof isArtifactTool === 'function' ? isArtifactTool : () => false

    const memoryCalls = toolCalls.filter(tc => isMem(tc.function?.name))
    const overflowCalls = toolCalls.filter(tc => isOvf(tc.function?.name))
    const codeCalls = toolCalls.filter(tc => isCode(tc.function?.name))
    const planCalls = toolCalls.filter(tc => isPlan(tc.function?.name))
    const artifactCalls = toolCalls.filter(tc => isArtifact(tc.function?.name))
    /** 其余走 MCP/Skill 通道；漏判会被整批丢给 mcpToolManager 而找不到实现，所以这里显式取反（plan/artifact 也必须进这串取反） */
    const otherCalls = toolCalls.filter(tc =>
        !isMem(tc.function?.name) && !isOvf(tc.function?.name) && !isCode(tc.function?.name) && !isPlan(tc.function?.name) && !isArtifact(tc.function?.name))
    return {memoryCalls, overflowCalls, codeCalls, planCalls, artifactCalls, otherCalls}
}

/**
 * @description 按 tool_call_id 反查工具名（对应 llmChat.js:602-605，前端展示与 trace 都要用）
 * @param {Object[]} toolCalls 已 prune 的调用
 * @returns {Object} id -> name
 */
export function buildToolNameIndex(toolCalls = []) {
    const byId = {}
    for (const tc of toolCalls) {
        if (tc?.id) {
            byId[tc.id] = tc.function?.name
        }
    }
    return byId
}

/* ---------- trace 快照截断（对应 llmChat.js:42-45） ---------- */



/**
 * @description 按 tool_call_id 反查工具的**入参**（与 `buildToolNameIndex` 成对）
 * @param {Object[]} toolCalls 已 prune 的调用
 * @returns {Object} id -> arguments（OpenAI 形态是 JSON 字符串，原样给，不在此解析）
 *
 * 为什么不复用 `buildToolNameIndex` 一次返回两个索引：那个函数已有调用方与既有测试口径，
 * 改它的返回形状会让"名字索引"这个语义变成要靠上下文才知道的东西。多一个 6 行的纯函数，
 * 换来两个索引各自可以被单独钉住。
 */
export function buildToolArgsIndex(toolCalls = []) {
    const byId = {}
    for (const tc of toolCalls) {
        if (tc?.id) {
            byId[tc.id] = tc.function?.arguments
        }
    }
    return byId
}



/** 入参进 trace 的默认字符预算（与 `clipTraceResult` 的 4000 同量级） */
export const DEFAULT_TRACE_ARGS_CHARS = 4000

/**
 * @description 工具入参进 trace 的快照：正文 + **原文长度 + 是否截断**三个字段分开给
 * @param {*} args 工具入参（字符串或对象）
 * @param {Number} [limit] 字符上限
 * @returns {{args: String, argsChars: Number, argsTruncated: Boolean}} 快照
 *
 * 为什么不像 `clipTraceResult` 那样把 `...[truncated]` 拼进字符串：那样读者**无从知道原文多长**，
 * "截断了"与"截了多少"被压成一个尾巴。这里 `argsChars` 永远是未截断的真实字符数，
 * `argsTruncated` 只说有没有裁，两者不互相污染（与 PR-B 段账本 `metrics.chars` 同一口径）。
 *
 * `argsChars: 0` 是有用事实（模型确实传了空参数），与"这一行没有该字段"（存量行未记录）不同——
 * 后者必须渲染成"未记录"，不能显示空参数冒充"模型没传参"。
 */
export function clipTraceArgs(args, limit = DEFAULT_TRACE_ARGS_CHARS) {
    const raw = typeof args === 'string' ? args
        : (args === null || args === undefined ? '' : JSON.stringify(args))
    const cap = Number(limit) > 0 ? Number(limit) : DEFAULT_TRACE_ARGS_CHARS
    const truncated = raw.length > cap
    return {
        args: truncated ? raw.slice(0, cap) : raw,
        argsChars: raw.length,
        argsTruncated: truncated,
    }
}

/**
 * 工具结果进 trace 的默认字符预算。
 * **它此前是硬编码在函数签名里的**（`limit = 4000`，两处调用点都不传），
 * 而实测 `finish` 口径 148 条调用记录里有 24 条正好停在 4014（4000 + 14 字符标注）
 * ⇒ 这不是"没触发过的预算"，是**在生产上真的在削数据、却调不动的那个值**。
 * 现在它只是兜底默认，真正的预算来自 `limits.toolResultTraceChars`。
 */
export const DEFAULT_TRACE_RESULT_CHARS = 4000

/**
 * @description 工具结果进 trace 的截断快照
 * @param {*} content 工具返回内容
 * @param {Number} [limit] 字符上限
 * @returns {String} 截断后的字符串
 */
export function clipTraceResult(content, limit = DEFAULT_TRACE_RESULT_CHARS) {
    const s = typeof content === 'string' ? content : JSON.stringify(content ?? '')
    return s.length > limit ? s.slice(0, limit) + '...[truncated]' : s
}

/**
 * @description 组装一条工具调用 trace（**两处出口共用一个构造器**）
 * @param {String} toolCallId 工具调用 id（也是留档 ref 的来源）
 * @param {String|null} toolName 工具名（反查不到时是 null）
 * @param {*} content 工具返回原文
 * @param {Object} [opts] 预算与反查表
 * @param {Object} [opts.argsById] `buildToolArgsIndex` 的产物
 * @param {Number} [opts.argsCap] 入参预算（`limits.toolArgsChars`）
 * @param {Number} [opts.resultCap] 结果预算（`limits.toolResultTraceChars`）
 * @returns {{id: String, name: String|null, result: String, args: String, argsChars: Number, argsTruncated: Boolean}} 一条 trace
 *
 * 为什么必须有这个函数：H1 之后这条记录是**前端能不能说真话的字段来源**，
 * 而它原先在 `llmChat.js` 里被内联写了**两遍**（溢出工具分支与通用分支各一份）。
 * 两遍意味着"改一处忘另一处"是可能的，而这类漂移在测试里不会响——
 * 底座现网就出现了一条形如 `{id,name,result}`（三键）的记录，与这两处代码应当产出的形状矛盾；
 * 把形状收到一个构造器里，并让它可被直接穷举测，是**把"我以为它不可能"变成"它被测过"**。
 * 字段顺序刻意与原内联写法一致，不制造任何跨仓契约变化。
 */
export function buildToolCallTraceEntry(toolCallId, toolName, content, opts = {}) {
    const {argsById = {}, argsCap, resultCap} = opts
    return {
        id: toolCallId,
        name: toolName,
        result: clipTraceResult(content, resultCap),
        ...clipTraceArgs(argsById[toolCallId], argsCap),
    }
}

/**
 * @description 找出**没有入参声明**的 trace 条目（探测器，不改数据、不读正文）
 * @param {Object[]} [toolCalls] 即将落库的 trace 条目
 * @returns {String[]} 缺声明条目的 id（不是正文；空数组表示形状正常）
 *
 * 为什么要这个函数：2026-11-12 在 cw2pc 出现过一条 `extInfo.toolCalls` 只有
 * `{id, name, result}` 三键的记录，而当时运行的代码（哈希核对过）在**每个出口**都展开了
 * `clipTraceArgs`——即便入参反查落空也应当给出 `argsChars: 0`。那次没有复现成功，
 * 所以我接受"目前无法解释"这件事，但要让它下次发生时**自己报告**，而不是靠人再去点一次界面。
 *
 * 判据用 `Number.isFinite` 而不是 `'argsChars' in t`：值为 `undefined` 的键会在 BSON 序列化时
 * 整体消失，那与"从来没写过这个键"在库里长得一模一样——只看键名会被它骗过一次。
 */
export function findTraceShapeGaps(toolCalls = []) {
    const list = Array.isArray(toolCalls) ? toolCalls : []
    return list
        .filter(t => t && typeof t === 'object' && !Number.isFinite(t.argsChars))
        .map(t => String(t.id ?? t.tool_call_id ?? ''))
}

/* ---------- 断开阶段策略（D3/D4；供 PR-C 使用，本刀只定义不接线） ---------- */

export const RUN_PHASES = ['generating', 'tool_executing', 'awaiting_input', 'idle']

/**
 * @description 连接断开时，按 run 当前所处阶段决定怎么处理
 * @param {String} phase RUN_PHASES 之一
 * @returns {{stopStream: Boolean, stopAfterBoundary: Boolean, persist: String, resumeFrom: String}}
 */
export function detachAction(phase) {
    switch (phase) {
        case 'tool_executing':
            /** 副作用已发生，半途而废最糟：跑完本批、落 postTools 现场，再停在边界 */
            return {stopStream: false, stopAfterBoundary: true, persist: 'abort', resumeFrom: 'postTools'}
        case 'awaiting_input':
            /** 已经落盘退出，零成本；等回答即可 */
            return {stopStream: false, stopAfterBoundary: false, persist: 'keep', resumeFrom: 'awaitInput'}
        case 'generating':
        default:
            /** 纯文本生成无副作用，可立即打断；半句存为 cancelled 段 */
            return {stopStream: true, stopAfterBoundary: true, persist: 'abort', resumeFrom: 'preCreate'}
    }
}

/**
 * @description 插话（steer）注入点的决策
 * @param {String} mode 'soft' | 'hard'
 * @param {String} phase 当前阶段
 * @returns {{injectAt: String, abortCurrentStream: Boolean}}
 */
export function steerAction(mode, phase) {
    if (mode === 'hard') {
        /** 硬插话只在生成阶段能立即打断；工具执行阶段退化成边界注入（D4：不打断副作用） */
        return phase === 'tool_executing'
            ? {injectAt: 'postTools', abortCurrentStream: false}
            : {injectAt: 'immediate', abortCurrentStream: true}
    }
    return {injectAt: 'boundary', abortCurrentStream: false}
}

/* ---------- PR-0.5：上游重试与备选档位（纯决策与包装器，接线在 llmChat） ---------- */

/**
 * @description 备选档位的"够不够装"判定
 * @param {Number} [tokens] 本次要发出去的 prompt token 估算值
 * @param {Object} [target] 备选档位的配置节点
 * @param {Number} [slackTokens] 预算余量（与 `context.slackTokens` 同口径）
 * @returns {{ok: Boolean, reason: String}} 判定
 * @description
 * 换档不是"换个模型再试一次"这么简单：备选档的上下文窗口通常更小（比如从 pro 换到 low），
 * 而这一轮的 messages 是按主档窗口装配的。**换到一个装不下的档位，会把一次"可重试的 503"
 * 换成一次"必然失败的 400"**——不但白花一次调用，还会让整轮以 permanent 错误收场。
 * 所以换档前必须核一次窗口，核不过就老老实实失败。
 */
export function canFallbackTo({tokens = 0, target = null, slackTokens = 0} = {}) {
    if (!target?.model) {
        return {ok: false, reason: 'no-target'}
    }
    const need = Number(tokens) + Number(target.maxTokens || 0) + Number(slackTokens || 0)
    const have = Number(target.contextWindow || 0)
    if (!(have > 0)) {
        return {ok: false, reason: 'target-window-unknown'}
    }
    return have >= need
        ? {ok: true, reason: ''}
        : {ok: false, reason: `装不下：need ${need} > have ${have}`}
}

/**
 * @description 带重试与换档的上游调用包装
 * @param {Object} params 参数
 * @param {Function} params.invoke 真正打一次上游：`({attempt, markFirstByte, usingFallback})`
 * @param {Function} [params.errorInfoOf] 把异常归一成 `{kind, message, status}`（默认 `describeError`）
 * @param {Function} [params.retryAfterMsOf] 从异常里取 429 的 Retry-After（毫秒）
 * @param {Function} [params.fallbackUsable] 换档前的可行性检查 `({usingFallback}) => {ok, reason}`
 * @param {Object} [params.cfg] 重试配置
 * @param {Object} [params.breaker] 进程内熔断器（`createBreaker`/`getBreaker` 的产物）。
 *   **不传就是完全旧行为**——这既是渐进上线的要求，也是让本函数保持可测的前提
 * @param {Function} [params.breakerKeyOf] `({usingFallback}) => 出口键`。
 *   必须是**当次真正使用的那一档**的出口，否则换档后的失败会记到错误的键上
 * @param {Function} [params.sleep] 等待实现（测试注入，避免真等）
 * @param {Function} [params.log] 观测回调 `({note, ...})`
 * @param {Function} [params.rng] 随机源
 * @returns {Promise<{value: any, attempts: Number, usingFallback: Boolean}>} 成功结果与过程计数
 * @throws 最后一次异常（原样抛出，不包装：上层要按原始错误决定落库形态）；
 *   熔断拒绝时抛 `UpstreamCircuitOpenError`（消息自描述 + `retryAfterMs`）——
 *   `describeError` 只看 `status`，不带特征串的话账本里会退化成一条普通 "api 503"，
 *   事后分不清"上游回了 503"与"我们自己没打出去"
 * @description
 * `markFirstByte` 是安全边界：`invoke` 内部**每次向客户端下发内容前**都要调它一次。
 * 一旦调过，本次失败就绝不重试（见 `upstreamRetryDecision` 规则 1）。
 */
export async function withUpstreamRetry({
    invoke,
    errorInfoOf = describeError,
    retryAfterMsOf = () => 0,
    /**
     * 可行性检查**默认放行**：换档是配置了 `fallbackModel` 就该发生的事，
     * 调用方接了钩子才有"窗口装不下"这类额外约束。
     * （第一版这里默认返回 `ok:false`，结果没接钩子时换档永远不发生，
     * 测试表现为"主档试尽就失败"——一个静默失效的功能比报错更难发现。）
     */
    fallbackUsable = () => ({ok: true, reason: ''}),
    cfg = {},
    breaker = null,
    breakerKeyOf = null,
    sleep = (ms) => new Promise(r => setTimeout(r, ms)),
    log = () => {},
    rng = Math.random,
} = {}) {
    let attempt = 0
    let usingFallback = false
    /* eslint-disable no-constant-condition */
    while (true) {
        attempt++
        const state = {firstByteSent: false}
        /**
         * 熔断问在**打出去之前**。放在 catch 里等于"先烧一次再说"，
         * 而 D39 要救的场景恰恰是"整个出口已经不行了还在打"。
         */
        const bKey = breaker && typeof breakerKeyOf === 'function' ? String(breakerKeyOf({usingFallback}) || '') : ''
        if (breaker && bKey) {
            const gate = breaker.allow({key: bKey})
            if (!gate.allowed) {
                log({note: '上游熔断中，未发起请求', key: bKey, reason: gate.reason, retryAfterMs: gate.retryAfterMs, phase: gate.phase, attempt})
                const err = new Error(`UpstreamCircuitOpen: relay 出口熔断中(${gate.reason})，未发起请求 retryAfterMs=${gate.retryAfterMs}`)
                err.name = 'UpstreamCircuitOpenError'
                err.retryAfterMs = gate.retryAfterMs
                err.upstreamKey = bKey
                /**
                 * 状态给 503：`describeError` 靠 `status` 归类，调用方与前端按"服务暂不可用"处理是对的。
                 * 但**不计入熔断**——被自己拒掉的请求不代表上游又坏了一次，
                 * 否则一旦打开就会靠自我拒绝永远关不上。
                 */
                err.status = 503
                throw err
            }
        }
        try {
            const value = await invoke({
                attempt,
                usingFallback,
                markFirstByte: () => {
                    state.firstByteSent = true
                },
            })
            /** 成功是唯一的"上游恢复了"证据：闭合电路并清零（半开探测成功也走这里） */
            if (breaker && bKey) {
                breaker.recordSuccess({key: bKey})
            }
            return {value, attempts: attempt, usingFallback}
        } catch (e) {
            const errorInfo = errorInfoOf(e)
            if (breaker && bKey) {
                /**
                 * 计不计由 `breakerCountsFailure` 判：上下文超长、内容审核、客户端中断
                 * 都**不是**出口健康信号——否则一个坏请求就能把所有人的会话熔断掉，
                 * 那比原来的缺陷更糟。
                 */
                const bcls = classifyUpstreamError(errorInfo)
                const bcnt = breakerCountsFailure({errorInfo, cls: bcls})
                const st = breaker.recordFailure({key: bKey, counts: bcnt.counts, reason: bcnt.reason})
                log({
                    note: '上游失败已交熔断记账', key: bKey, counts: bcnt.counts,
                    reason: bcnt.reason, phase: st.phase, failures: st.failures,
                })
            }
            /**
             * 已经决定要换档、却在换档这一步被可行性检查拦下时，不再回到主档反复试：
             * 主档已经试尽 maxAttempts 次了，回到它只会是同一个 503。
             * 所以这里把 `fallbackModel` 临时摘掉再问一次决策——语义是"没有备选可用"。
             */
            let askCfg = cfg
            if (usingFallback) {
                askCfg = {...cfg, fallbackModel: ''}
            } else if (cfg.fallbackModel) {
                /** 只在决策真的要换档时才核窗口：核不动就当没有备选（宁可失败，不要换成必然失败） */
                const probe = upstreamRetryDecision({errorInfo, attempt, firstByteSent: state.firstByteSent, cfg, rng})
                if (probe.action === 'fallback') {
                    const usable = fallbackUsable({usingFallback})
                    if (!usable?.ok) {
                        log({note: '换档被可行性检查拦住', reason: usable?.reason || 'unknown'})
                        askCfg = {...cfg, fallbackModel: ''}
                    }
                }
            }
            const d = upstreamRetryDecision({
                errorInfo,
                attempt,
                firstByteSent: state.firstByteSent,
                cfg: askCfg,
                retryAfterMs: retryAfterMsOf(e),
                rng,
            })
            log({note: `上游第 ${attempt} 次失败`, action: d.action, reason: d.reason, delayMs: d.delayMs, usingFallback})
            if (d.action === 'retry') {
                if (d.delayMs > 0) {
                    await sleep(d.delayMs)
                }
                continue
            }
            if (d.action === 'fallback') {
                usingFallback = true
                continue
            }
            /** 原样抛出：上层要按 `describeError` 的 kind 决定落库是 abort 还是 error */
            throw e
        }
    }
}


/**
 * 可重试的上游状态码。
 * 只列"重试有意义"的那些：**429 与 5xx 是暂时性的**，重试会换到不同的后端实例或等窗口过去。
 * 故意不列 400/401/403/404——那些是请求本身有问题或鉴权坏了，重试只会把 relay 的额度再烧一遍。
 */
export const UPSTREAM_RETRYABLE_STATUS = [408, 409, 425, 429, 500, 502, 503, 504, 529]

/**
 * 不可重试的错误特征：正文已经超了窗口这类问题，重试一万次也是同一个结果。
 * 命中它不但不该重试，还该把"该走压缩/该报错"的信号留出来。
 */
export const UPSTREAM_PERMANENT_PATTERNS = [
    /context.{0,12}(length|window).{0,12}(exceed|over|limit)/i,
    /maximum context length/i,
    /too many tokens/i,
    /invalid.{0,8}api.{0,8}key/i,
    /insufficient (quota|balance|credit)/i,
    /content_policy|content filter|flagged/i,
]

/**
 * @description 判断一个上游错误是不是"重试有可能变好"
 * @param {Object} errorInfo `describeError` 的产物 {kind, message, status}
 * @returns {{retryable: Boolean, permanent: Boolean, reason: String}} 判定
 */
export function classifyUpstreamError(errorInfo = {}) {
    const msg = String(errorInfo.message || '')
    /**
     * 永久性错误优先判：一条 400 的"上下文超长"如果只看状态码就会被放进取退重试里，
     * 结果是**同一份必然失败的请求烧三次钱**。顺序不能反过来。
     */
    if (UPSTREAM_PERMANENT_PATTERNS.some(re => re.test(msg))) {
        return {retryable: false, permanent: true, reason: 'permanent'}
    }
    /**
     * 中断不是故障（与 `describeError` 的口径一致）：客户端断开引发的 AbortError 绝不重试，
     * 否则"用户关了页面"会变成"服务端替他重试三轮"。
     */
    if (errorInfo.kind === 'abort') {
        return {retryable: false, permanent: false, reason: 'abort'}
    }
    const status = Number(errorInfo.status)
    if (status > 0) {
        return UPSTREAM_RETRYABLE_STATUS.includes(status)
            ? {retryable: true, permanent: false, reason: `status-${status}`}
            : {retryable: false, permanent: false, reason: `status-${status}-not-retryable`}
    }
    /**
     * 没有状态码的 api 错误（连接被拒、DNS、socket 断开、超时）**算可重试**：
     * 现网最常见的"relay 抖动"正是这一类——它连状态码都拿不到。
     */
    if (errorInfo.kind === 'api') {
        return {retryable: true, permanent: false, reason: 'transport'}
    }
    return {retryable: false, permanent: false, reason: errorInfo.kind || 'unknown'}
}

/**
 * @description 退避时长：满抖动（full jitter）
 * @param {Number} attempt 第几次尝试（从 1 开始）
 * @param {Number} [baseMs] 基准
 * @param {Number} [capMs] 上限
 * @param {Function} [rng] 随机源（0~1），测试注入定值
 * @returns {Number} 毫秒
 */
export function backoffMs({attempt = 1, baseMs = 300, capMs = 4000, rng = Math.random} = {}) {
    /** 指数部分按 attempt-1：第 1 次重试就是 baseMs 量级 */
    const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1))
    /** 满抖动取 [0, exp]，不是 exp 的一半起步——多实例同时挂时会形成 thundering herd，满抖动才拉得开 */
    return Math.round(Math.max(0, Math.min(1, rng())) * exp)
}

/**
 * @description 一次上游调用失败后，决定"重试 / 换档 / 放弃"
 * @param {Object} params 参数
 * @param {Object} params.errorInfo `describeError` 的产物
 * @param {Number} params.attempt 刚才那次是第几次（1=首发）
 * @param {Boolean} params.firstByteSent **是否已经向客户端下发过首字节**
 * @param {Object} [params.cfg] 重试配置（enabled/maxAttempts/baseMs/capMs/fallbackModel）
 * @param {Number} [params.retryAfterMs] 上游 429 的 Retry-After（毫秒）
 * @param {Function} [params.rng] 随机源
 * @returns {{action: String, delayMs: Number, reason: String, attempt: Number}}
 *          action: 'retry' | 'fallback' | 'fail'
 * @description
 * 三条硬规则，按优先级排：
 * 1. **下发过首字节就绝不重试**（`firstByteSent`）。这是本 PR 的边界：一次已经吐了字的调用
 *    在客户端看来是"正在回答"，重发会让用户看到重复内容、段序错乱、`reset` 之外的第二种拼接形态。
 *    所以重试只覆盖"首字节前的失败"——那类失败对客户端是**不可见的**，重试才是安全的。
 * 2. 同一档位最多试 `maxAttempts` 次；用尽了还有 `fallbackModel` 就换档**一次**（不再递归换档，
 *    避免"A 挂了切 B、B 挂了切回 A"这种环）。
 * 3. 永久错误直接放弃（见 `classifyUpstreamError`）。
 */
export function upstreamRetryDecision({
    errorInfo = {},
    attempt = 1,
    firstByteSent = false,
    cfg = {},
    retryAfterMs = 0,
    rng = Math.random,
} = {}) {
    if (cfg.enabled !== true) {
        return {action: 'fail', delayMs: 0, reason: 'disabled', attempt}
    }
    /** 规则 1：首字节后不重试。这一条必须排在可重试判定之前——它比"错误类型"更硬 */
    if (firstByteSent) {
        return {action: 'fail', delayMs: 0, reason: 'first-byte-sent', attempt}
    }
    const cls = classifyUpstreamError(errorInfo)
    if (!cls.retryable) {
        return {action: 'fail', delayMs: 0, reason: cls.reason, attempt}
    }
    const maxAttempts = Math.max(1, Number(cfg.maxAttempts) || 3)
    if (attempt < maxAttempts) {
        /**
         * 429 的 `Retry-After` 优先于我们的指数退避：上游明确告诉你什么时候再来，
         * 比任何抖动猜测都准。但仍要夹在 `capMs` 之内——不能因为上游说"5 分钟后再试"
         * 就把一个在线请求挂在那儿，那不是重试是排队。
         */
        const cap = Number(cfg.capMs) || 4000
        const delay = Number(retryAfterMs) > 0
            ? Math.min(Number(retryAfterMs), cap)
            : backoffMs({attempt: attempt + 1, baseMs: Number(cfg.baseMs) || 300, capMs: cap, rng})
        return {action: 'retry', delayMs: delay, reason: cls.reason, attempt}
    }
    /** 规则 2：本档试尽了，才考虑换档；换档只此一次 */
    if (cfg.fallbackModel && attempt >= maxAttempts) {
        return {action: 'fallback', delayMs: 0, reason: `${cls.reason}-exhausted`, attempt}
    }
    return {action: 'fail', delayMs: 0, reason: `attempts-exhausted(${cls.reason})`, attempt}
}

export default {
    resolveProtocol,
    accumulateToolCalls,
    pruneToolCalls,
    buildAssistantToolCallMessage,
    classifyToolCalls,
    buildToolNameIndex,
    buildToolArgsIndex,
    DEFAULT_TRACE_RESULT_CHARS,
    DEFAULT_TRACE_ARGS_CHARS,
    clipTraceResult,
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
    normalizeUsage,
    addUsage,
    deriveUsageMetrics,
    usageCallAlert,
    resolveMaxIterations,
    finalizationDecision,
    buildFinalizeBody,
    exhaustedFallback,
    detachAction,
    steerAction,
    classifyUpstreamError,
    backoffMs,
    upstreamRetryDecision,
    canFallbackTo,
    withUpstreamRetry,
    UPSTREAM_RETRYABLE_STATUS,
    UPSTREAM_PERMANENT_PATTERNS,
    RUN_PHASES,
    DEFAULT_MAX_ITERATIONS,
    MAX_ITERATIONS_CEILING,
    FINALIZE_HINT_TEXT,
    EXHAUSTED_NOTICE_TEXT,
}
