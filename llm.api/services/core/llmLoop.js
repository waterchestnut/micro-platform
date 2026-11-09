/**
 * @fileOverview execChat 主循环的纯决策逻辑
 * @module services/core/llmLoop
 * @description
 * `execChat` 是 700 行、零单测的函数（`docs/session-run-plan.md` §2.10），而 PR-A/B/C/D/E 全都要改它。
 * 本模块把其中**不需要 OpenAI / 数据库 / MCP 就能判定**的部分抽出来，先装上测试，
 * 再让 `llmChat.js` 反过来消费它——这样后续重构有一张真正的网，而不是靠改完手点。
 *
 * 三条纪律：
 * 1. **零副作用、零外部依赖**：判定所需的谓词（哪些是记忆/溢出/代码工具）由调用方注入，
 *    否则本模块会被 `mcp/`、`memory/`、`sandbox/` 的模块级连接拖住，又变成离线不可测。
 * 2. **行为必须与抽出前逐字一致**：包括"没有 index 的 tool_call 增量被丢弃"这类看起来像 bug
 *    的现状——**先钉住现状，再在 PR-A 里决定是否改**，不要在抽取的同一刀里夹带修复。
 * 3. 新增的判定表（如断开阶段策略）**只定义不接线**，等 PR-C 用到时再接，避免提前改行为。
 */

/* ---------- 协议协商（对应 llmChat.js 的 clientProtocol / emitToolResults） ---------- */

/**
 * @description 协商事件协议版本
 * @param {Object} options 请求 options
 * @returns {{protocol: Number, emitToolResults: Boolean}}
 */
export function resolveProtocol(options = {}) {
    const protocol = Number(options.protocol) >= 2 ? 2 : 1
    return {
        protocol,
        /** 协议 2 的客户端按事件名分派，因此默认下发工具结果；协议 1 需显式开启 */
        emitToolResults: protocol === 2 || !!options.streamToolResults,
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
 * @returns {Promise<{content: String, reasoning: String, toolCalls: Object[], receivedToolCall: Boolean, finishReason: String|null, chunkCount: Number, deltaCount: Number, usage: Object, usageChunks: Number}>}
 *
 * 现状（本函数原样保留，不在这一刀改）：
 * - `chunk.choices[0]` 不做空值防护 ⇒ chunk 缺 `choices` 字段会抛错；`execChat` 当时**没有 try/catch**，
 *   异常直接冒到上层（已在 PR-A 补上）；`choices: []`（末帧 usage）是安全的，且 usage 就在这一帧上取。
 * - 判定"本轮是否要求调用工具"用的是 `delta.tool_calls` **字段是否存在**，不是数组是否非空
 *   ⇒ `tool_calls: []` 也会置 receivedToolCall=true。
 */
export async function drainAssistantStream(chunks, {onDelta} = {}) {
    let content = ''
    let reasoning = ''
    let toolCalls = []
    let receivedToolCall = false
    let finishReason = null
    let chunkCount = 0
    let deltaCount = 0
    let usage = createEmptyUsage()
    let usageChunks = 0

    for await (const chunk of chunks) {
        chunkCount++
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

    return {content, reasoning, toolCalls, receivedToolCall, finishReason, chunkCount, deltaCount, usage, usageChunks}
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
    /** 理论上不可达：while 的另一个出口是 `options.signal.aborted` 的提前 return，不会走到这里 */
    return 'unknown'
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
export function classifyToolCalls(toolCalls = [], {isMemoryTool, isOverflowTool, isCodeTool} = {}) {
    const isMem = typeof isMemoryTool === 'function' ? isMemoryTool : () => false
    const isOvf = typeof isOverflowTool === 'function' ? isOverflowTool : () => false
    const isCode = typeof isCodeTool === 'function' ? isCodeTool : () => false

    const memoryCalls = toolCalls.filter(tc => isMem(tc.function?.name))
    const overflowCalls = toolCalls.filter(tc => isOvf(tc.function?.name))
    const codeCalls = toolCalls.filter(tc => isCode(tc.function?.name))
    /** 其余走 MCP/Skill 通道；漏判会被整批丢给 mcpToolManager 而找不到实现，所以这里显式取反 */
    const otherCalls = toolCalls.filter(tc => !isMem(tc.function?.name) && !isOvf(tc.function?.name) && !isCode(tc.function?.name))
    return {memoryCalls, overflowCalls, codeCalls, otherCalls}
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
 * @description 工具结果进 trace 的截断快照
 * @param {*} content 工具返回内容
 * @param {Number} [limit] 字符上限
 * @returns {String} 截断后的字符串
 */
export function clipTraceResult(content, limit = 4000) {
    const s = typeof content === 'string' ? content : JSON.stringify(content ?? '')
    return s.length > limit ? s.slice(0, limit) + '...[truncated]' : s
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

export default {
    resolveProtocol,
    accumulateToolCalls,
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
    RUN_PHASES,
    DEFAULT_MAX_ITERATIONS,
    MAX_ITERATIONS_CEILING,
    FINALIZE_HINT_TEXT,
    EXHAUSTED_NOTICE_TEXT,
}
