/**
 * @fileOverview 上下文五层降级的纯判据（PR-K2 判据刀；执行体接线按 P-15 重跑数据排期）
 * @module services/core/context/tiers
 * @description
 * §5.1 的分层不是工程口味，是钱：**T1 只追加、T2 留句柄、T3 清旧工具结果、T4 摘要**——
 * 每往下一层就多付一次"重写前缀的代价"（P-2b 实测非缓存字节随历史线性增长，摘要救不了缓存），
 * 所以顺序必须"先做不需要模型调用的层"（§5.1），T4 默认关（N9）。
 *
 * 本件的立场与 §5.3/D65 一致：**判据先行，接线等数据**。P-15 重跑（2026-11-15，45 天 948 条档案）
 * 越界 0 次、峰值比值 0.35——`clearToolResults` 今天接进主循环就是一段永远不会执行的代码，
 * 为一个零收益的架构改动付钱正是 D65 点名批评过的错。判据把这层"契约"先钉死：
 * 触发线出现那天，接的是被穷举测过的决策，不是现场新写的分支。
 *
 * 关键判据决定（都在 §5 与 D24/N9/§5.4/§17-14）：
 *   - `budget` 缺失或非有限（底座的 contextWindow 守卫给 Infinity）⇒ **不判为 0 比值**，
 *     返回 null"量不出"——把"没量过"写成"很安全"是 D66 反推 cachedTokens 的同款造假；
 *   - 越界后先 T3（无模型调用）后 T4（有模型调用），两级都不许动 `role:system/user/assistant`：
 *     §17-14 的"约束存活"硬测法（连续 N 次降级后 pinned constraint 逐字可恢复）靠的就是
 *     clearing **只作用于 tool 消息**这个结构性质，不是靠事后找回；
 *   - 清过的消息再清必须无操作（幂等）：边界重复、重放、崩溃续跑都可能重复调用，
 *     二次清空把 marker 里的句柄也清掉就真的取不回原文了；
 *   - 摘要铁律一做成**机器闸**：输入里出现 digest 派生物直接拒，不给"滚动更新 digest"留活路
 *     （v1.0 的错误是把它设成默认，比设成默认更糟的是让它成为代码路径）。
 */

export const TIER_LEVELS = ['T1', 'T2', 'T3', 'T4']

/** 被清空的消息 content 以此开头——幂等判据与 marker 契约共用这一个常量，别在别处写第二份 */
export const CLEARED_MARKER_PREFIX = '[已清空·可取回'

/**
 * @description 预算占用比（Infinity/缺失 ⇒ null=量不出，绝不给 0）
 * @param {Number} total 本轮装配后的 token 估算
 * @param {Number} budget 输入预算（calcContextBudget 或底座守卫后的 Infinity）
 * @returns {Number|null} 比值或 null
 */
export function contextPressureRatio(total, budget) {
    const t = Number(total)
    const b = Number(budget)
    if (!Number.isFinite(t) || t < 0) return null
    if (!Number.isFinite(b) || b <= 0) return null
    return t / b
}

/**
 * @description 降级决策表（§5.1 顺序 + N9 默认关）。纯函数：不查库、不改消息、不发事件。
 * @param {Object} p {total, budget, tiersConfig, projectedTotalAfterClear}
 *   projectedTotalAfterClear 留给编排层二跳用（先 clear 后还想 digest 时带预估值再来一次）。
 * @returns {{action:String, tierApplied:String|null, reason:String}} action ∈ none|pressure|clear|digest|overflow
 */
export function decideContextAction({total, budget, tiersConfig = {}, projectedTotalAfterClear = undefined, clearExhausted = false} = {}) {
    const cfg = {
        pressureRatio: 0.85,
        clearEnabled: false,
        digestEnabled: false,
        ...tiersConfig,
    }
    const useTotal = Number.isFinite(Number(projectedTotalAfterClear)) ? Number(projectedTotalAfterClear) : Number(total)
    const ratio = contextPressureRatio(useTotal, budget)
    if (ratio === null) {
        return {action: 'none', tierApplied: null, reason: 'budget-unmeasurable（量不出不等于放得下，但没有任何一层该由量不出触发）'}
    }
    if (useTotal > Number(budget)) {
        // clearExhausted 是调用方的显式声明（"最近 keepRecentN 之外已经没有可清的 tool 消息"）——
        // 没有这个位，"clear 后仍越界再来一次"会在决策表里原地循环；判据自己就该防住这条边。
        if (cfg.clearEnabled && !clearExhausted) {
            return {action: 'clear', tierApplied: 'T3', reason: `越界 ratio=${ratio.toFixed(2)}，先走无模型调用的 clearing`}
        }
        if (cfg.digestEnabled) {
            return {action: 'digest', tierApplied: 'T4', reason: `越界 ratio=${ratio.toFixed(2)} 且 clearing 未启/仍越界，T4 兜底`}
        }
        return {action: 'overflow', tierApplied: null, reason: `越界 ratio=${ratio.toFixed(2)}，允许的重写层都未启用——如实把决定交回调用方，不静默硬发`}
    }
    if (ratio >= cfg.pressureRatio) {
        return {action: 'pressure', tierApplied: 'T1', reason: `接近预算 ratio=${ratio.toFixed(2)}，只发预警事件，不改写任何消息`}
    }
    return {action: 'none', tierApplied: null, reason: `ratio=${ratio.toFixed(2)} 在压力线下`}
}

/**
 * @description T3 tool-result clearing 的执行判据（纯函数，返回新数组；接线在编排层）
 * @param {Object[]} messages 会话消息（OpenAI 形态）
 * @param {Object} [opts] {keepRecentN=4, refOf}
 *   refOf(toolMsg) 给每条被清消息取"可取回句柄"（现网是 tool_call_id + 溢出留存 ref）——
 *   句柄从哪来是接线的事，判据只保证**没有句柄就不清**：清空后取不回，T3 就退化成丢信息。
 * @returns {{messages:Object[], cleared:Object[], skippedNoRef:Number}} 结果
 *
 * 三条结构性保证（§17-14 约束存活的依据就建在这上面，不是事后补救）：
 *   1. 只碰 role==='tool' 的消息，system/user/assistant 逐字节不动；
 *   2. 最近 keepRecentN 条工具结果 verbatim 保留（模型正在用的东西不许清）；
 *   3. 已带清空 marker 的条目幂等跳过——二次清空会连句柄一起清没。
 */
export function clearToolResults(messages = [], opts = {}) {
    const {keepRecentN = 4, refOf = (m) => m?.tool_call_id} = opts
    const idx = []
    messages.forEach((m, i) => {
        if (m && m.role === 'tool') idx.push(i)
    })
    const toConsider = idx.slice(0, Math.max(0, idx.length - keepRecentN))
    const cleared = []
    const out = [...messages]
    let skippedNoRef = 0
    for (const i of toConsider) {
        const m = out[i]
        const content = String(m.content ?? '')
        if (content.startsWith(CLEARED_MARKER_PREFIX)) {
            continue
        }
        const ref = refOf(m)
        if (!ref) {
            skippedNoRef++
            continue
        }
        cleared.push({toolCallId: m.tool_call_id || '', chars: content.length, ref})
        out[i] = {...m, content: `${CLEARED_MARKER_PREFIX} ref=${ref}] 原 ${content.length} 字符已移出上下文，可按句柄取回`}
    }
    return {messages: out, cleared, skippedNoRef}
}

/** §5.4 铁律二的点名清单（缺一段的 digest prompt 就是漏一段会重犯的失忆） */
export const DIGEST_REQUIRED_SECTIONS = ['任务陈述', '已查过的路径/资源及内容要点', '已做的决策与理由', '已试过且失败的方案与失败原因']

/**
 * @description 铁律一的机器闸：digest 的原料里出现任何 digest 派生物 ⇒ 拒
 * @param {Object[]} inputs [{kind:'raw'|'digest', text}]
 * @returns {{ok:Boolean, error?:String}} 结果
 */
export function assertDigestFromRaw(inputs = []) {
    if (!Array.isArray(inputs) || !inputs.length) {
        return {ok: false, error: 'digest 原料为空（没有 raw 可派生就不要生成 digest）'}
    }
    if (inputs.some((x) => x?.kind === 'digest')) {
        return {ok: false, error: '铁律一：摘要必须从 raw 派生，绝不喂上一个 digest（滚动 digest 的每一代都比上一代更像传言）'}
    }
    return {ok: true}
}

/**
 * @description 从文本里提标识符（URL / 文件路径 / 反引号代码段）——铁律三的逐字保留校验集
 * @param {String} text 原文
 * @returns {String[]} 去重后的标识符
 */
export function extractIdentifiers(text = '') {
    const t = String(text)
    const found = new Set()
    for (const m of t.matchAll(/https?:\/\/[^\s"'`)\]]+/g)) found.add(m[0])
    for (const m of t.matchAll(/(?:[A-Za-z0-9_@.\-\u4e00-\u9fa5]+\\)+[A-Za-z0-9_@.\-\u4e00-\u9fa5]+\.[A-Za-z0-9]{1,8}/g)) found.add(m[0])
    for (const m of t.matchAll(/`([^`\n]{3,120})`/g)) found.add(m[1])
    return [...found]
}

/**
 * @description 铁律三校验：raw 的标识符必须逐字出现在 digest 里
 * @param {String[]} rawTexts 原文数组
 * @param {String} digestText 摘要文本
 * @returns {{ok:Boolean, missing:String[]}} 结果
 */
export function verifyIdentifiersPreserved(rawTexts = [], digestText = '') {
    const missing = []
    for (const raw of rawTexts) {
        for (const id of extractIdentifiers(raw)) {
            if (!digestText.includes(id)) missing.push(id)
        }
    }
    return {ok: missing.length === 0, missing}
}

/** 铁律三：输出前挂 reference only 声明（digest 是二手材料，得在文本里自证） */
export const REFERENCE_ONLY_PREFIX = '<!-- reference only: 本段为自动摘要，非原始记录；标识符逐字保留，其余以 raw 为准 -->\n'

/**
 * @description context_pressure 事件载荷（§6 line 717；tierApplied 枚举闸在这，写错档位红在装配前）
 * @param {Object} p {iteration, tokens, budget, tierApplied}
 * @returns {Object} 事件对象
 */
export function buildContextPressureEvent({iteration, tokens, budget, tierApplied = 'T1'} = {}) {
    if (!TIER_LEVELS.includes(tierApplied)) {
        throw new Error(`context_pressure.tierApplied=${JSON.stringify(tierApplied)} 不在 ${TIER_LEVELS.join('|')}`)
    }
    return {type: 'context_pressure', iteration: Number(iteration) || 0, tokens: Number(tokens) || 0, budget: Number.isFinite(Number(budget)) ? Number(budget) : null, tierApplied}
}

/**
 * @description context_compacted 事件载荷（清了什么、省了多少、句柄在哪——三条都不可省，
 *  否则前端只能显示"变短了"，而"变短了多少可追回"才是用户敢继续聊的依据）
 * @param {Object} p {mode, iteration, clearedCount, freedTokensEst, handles}
 * @returns {Object} 事件对象
 */
export function buildContextCompactedEvent({mode, iteration, clearedCount, freedTokensEst, handles = []} = {}) {
    if (mode !== 'clearing' && mode !== 'digest') {
        throw new Error(`context_compacted.mode=${JSON.stringify(mode)} 只许 clearing|digest`)
    }
    return {
        type: 'context_compacted',
        mode,
        iteration: Number(iteration) || 0,
        clearedCount: Number(clearedCount) || 0,
        freedTokensEst: Number(freedTokensEst) || 0,
        handles: handles.slice(0, 16),
    }
}

export default {TIER_LEVELS, CLEARED_MARKER_PREFIX, contextPressureRatio, decideContextAction, clearToolResults, DIGEST_REQUIRED_SECTIONS, assertDigestFromRaw, extractIdentifiers, verifyIdentifiersPreserved, REFERENCE_ONLY_PREFIX, buildContextPressureEvent, buildContextCompactedEvent}
