/**
 * @fileOverview 会话/任务树的规范化消耗（credits）判定（PR-任务编排 M1-a，纯函数）
 * @module services/core/session/creditMeter
 * @description
 * 目标（属主拍板）：本期把"会话 token 消耗算清楚、为以后会员制积分做准备"。**"为积分做准备"≠"现在是钱"**——
 * 本件只产出**无量纲的 credit 单位**（规范化消耗计数），汇率/兑换比是产品决定，刻意不在此落（`conf/llmModel.js`
 * 至今没有任何价格字段，硬编一个就是假承诺）。
 *
 * 判定与 IO 分离（照 runGate/taskAdmission）：单价权重 `weights` 由调用方从配置读来注入；
 * **缺权重 ⇒ 退化为纯 token 计数（credits = prompt+completion）并 `priced:false`**，不猜价。
 *
 * 一个诚实边界：被掐断的 run 收不到 usage 帧（`llmUsageSchema.js:87` 实测 10,772 字 → completionTokens 记 0），
 * 所以调用方应把"生成字符兜底"折算进 completionTokens 再喂进来；本件信任输入、不替上游编数。
 */

/** 无注入权重时的退化口径：权重全 1、附加项 0 ⇒ credits 就是 token 计数，且不谎称"已计价" */
const FALLBACK_WEIGHTS = {
    inputWeight: 1,
    outputWeight: 1,
    toolCallCost: 0,
    sandboxSecondCost: 0,
    tierWeights: {}, // {modelTier: {input, output}} 缺省用 inputWeight/outputWeight
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

/**
 * @description 把一次调用/一个子任务的消耗折算成规范化 credit 单位
 * @param {Object} p 参数
 * @param {Number} [p.promptTokens] 输入 token
 * @param {Number} [p.completionTokens] 输出 token
 * @param {String} [p.modelTier] 模型档（llmModel family，如 common/qwen/qwen_vl）；可选
 * @param {Number} [p.toolCalls] 工具调用次数（附加消耗，需 weights 给了 toolCallCost 才计）
 * @param {Number} [p.sandboxSeconds] 沙箱占用秒（同上）
 * @param {Object} [p.weights] 注入权重（缺省退化为纯 token 计数）
 * @returns {{credits:Number, priced:Boolean, parts:Object}} credits 与明细
 * @remarks `priced:false` 表示"这次没配价，credits 只是 token 计数，不能当钱"。
 */
export function computeCredits({
    promptTokens = 0, completionTokens = 0, modelTier = '',
    toolCalls = 0, sandboxSeconds = 0,
    weights,
} = {}) {
    const w = {...FALLBACK_WEIGHTS, ...(weights || {})}
    const tierW = (modelTier && w.tierWeights && w.tierWeights[modelTier]) || null
    const iw = tierW ? num(tierW.input) : num(w.inputWeight)
    const ow = tierW ? num(tierW.output) : num(w.outputWeight)

    const pTok = num(promptTokens)
    const cTok = num(completionTokens)
    const tool = num(toolCalls)
    const sbx = num(sandboxSeconds)

    const inputCredits = pTok * (iw || 1)
    const outputCredits = cTok * (ow || 1)
    const toolCredits = tool * num(w.toolCallCost)
    const sandboxCredits = sbx * num(w.sandboxSecondCost)

    const credits = Math.round((inputCredits + outputCredits + toolCredits + sandboxCredits) * 1e6) / 1e6

    return {
        credits,
        // 只用了退化权重（token 计数）⇒ 未计价；给了价类权重或附加项 ⇒ priced
        priced: !!(tierW || num(w.inputWeight) !== 1 || num(w.outputWeight) !== 1
            || num(w.toolCallCost) > 0 || num(w.sandboxSecondCost) > 0),
        parts: { inputCredits, outputCredits, toolCredits, sandboxCredits },
    }
}

/**
 * @description 会话/任务树级 rollup：把多个调用点的 credits 求和（root+所有 children 归一到同一会话）
 * @param {Object[]} items `computeCredits` 的产物数组（或含 credits 的对象数组）
 * @param {Object[]} [itemLike] 兼容直接喂原始计数数组（内部逐条 computeCredits）
 * @returns {{totalCredits:Number, priced:Boolean, count:Number}} 汇总（任一未计价 ⇒ 整体 priced:false 提示）
 * @remarks rollup 只做加法与 priced 归约，不重新定义 credits 口径（口径唯一在 computeCredits）。
 */
export function rollupCredits(items = []) {
    let total = 0
    let priced = items.length > 0
    let count = 0
    for (const it of items || []) {
        if (it == null) continue
        count += 1
        if (typeof it.credits === 'number') {
            total += it.credits
            if (it.priced === false) priced = false
        } else {
            const c = computeCredits(it)
            total += c.credits
            if (!c.priced) priced = false
        }
    }
    return { totalCredits: Math.round(total * 1e6) / 1e6, priced, count }
}

/**
 * @description 账本落账点的字段构造器——**"双处白名单一致"的结构化答案**
 * @param {Object} p
 * @param {Number} [p.promptTokens] 累计输入 token
 * @param {Number} [p.completionTokens] 累计输出 token
 * @param {Object} [p.model] `config.models[key]` 的模型节点（用它的 `family` 作 tier；换档后传**实际回答的档**）
 * @param {Object} [p.weights] 计价权重（`config.credits.weights`；缺省⇒退化 token 计数、priced:false）
 * @param {Number} [p.toolCalls] 工具调用数——**本期两处落账点都不传**：现成的 `modelCalls` 是模型调用数，
 *   语义不同，宁可缺一个附加项也不喂错义的值（"读不出就不计，不等于零"的同族纪律）。
 * @returns {{credits:Number, creditsPriced:Boolean}} 要写进 llmUsage 的两个字段
 * @description
 * llmChat 有**两处**枚举落账字段（在途刷新 + 收尾落账）。若两处各写一遍 credits 口径，
 * 就是 D66"同一个数存两处必分叉"在这里的现形。所以两处都只展平这一个函数——
 * 口径改动只会发生一次（在 `computeCredits`），调用点没有"各改各的"的机会。
 */
export function buildUsageCreditsFields({ promptTokens = 0, completionTokens = 0, model, weights } = {}) {
    const c = computeCredits({
        promptTokens,
        completionTokens,
        modelTier: (model && model.family) || '',
        weights,
    })
    return { credits: c.credits, creditsPriced: c.priced }
}

export default { computeCredits, rollupCredits, buildUsageCreditsFields, FALLBACK_WEIGHTS }
