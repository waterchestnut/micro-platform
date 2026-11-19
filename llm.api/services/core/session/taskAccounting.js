/**
 * @fileOverview 任务×账本交汇处的口径（PR-任务编排 §5-4，纯函数）
 * @module services/core/session/taskAccounting
 * @description
 * 两件事都住在"execChat 的 options"与"llmUsage 行"的交界上，判据集中在此，写入点只做 IO：
 * 1. `extractTaskFields`：从 run 的 options.taskContext 白名单抽 `rootCode/agentCode/agentRole` 三个平铺字段
 *    （llmUsage 关联列的数据源）。**白名单+类型+长度三重收**：这不是展示字段，是要进索引与对账查询的键——
 *    调用方（agentChat/turnRunner/finalize）传什么不该直接信：非字符串丢、超 128 截断前先拒（拒>裁，
 *    静默截断的键会让"按 rootCode 查账"查出一半对不上的行）。
 * 2. `budgetAllowsFollow`：追活（retry/replan spawn）前的预算闸。**转调 taskBudget.checkBudget**，
 *    不重造阈值（§7-3 单 root 100 万天花板与 degrade 阶梯单源在那）；planned=本轮想 spawn 的行数。
 *    裁决与数据分离：tokensUsed 由调用方从**账本行**现算（Σ child llmUsage.totalTokens），本件不查库。
 * 编排每一刀：agentRole 取值口径与 handoff §0 一致：root|serialized-turn|child|synthesis。
 * planner 不跑 execChat 无 usage 行故不在列——**finalize 同理**（它是派发逻辑，自己的
 * 花费以 synthesis 行记账；排查刀把虚位列从枚举收掉，枚举不许宽于写入方现实）。
 */
import { checkBudget, DEFAULT_ROOT_TOKEN_CEILING } from './taskBudget.js'

export const USAGE_AGENT_ROLES = ['root', 'serialized-turn', 'child', 'synthesis']
const MAX_CODE_LEN = 128 // 与 agentCode/messageCode 的列宽一致；超长=键形态已污染，拒收不裁剪

const cleanCode = (v) => (typeof v === 'string' && v && v.length <= MAX_CODE_LEN ? v : undefined)

/**
 * @description 白名单抽取 llmUsage 任务关联字段（缺/脏一律不写键——"缺席"与"写了空串"在查询里是两回事）
 * @param {Object} [options] execChat 的 options
 * @returns {{rootCode?:String, agentCode?:String, agentRole?:String}} 只含通过校验的键
 */
export function extractTaskFields(options = {}) {
    const ctx = options?.taskContext
    if (!ctx || typeof ctx !== 'object') return {}
    const out = {}
    const rootCode = cleanCode(ctx.rootCode)
    const agentCode = cleanCode(ctx.agentCode)
    const agentRole = typeof ctx.agentRole === 'string' && USAGE_AGENT_ROLES.includes(ctx.agentRole) ? ctx.agentRole : undefined
    if (rootCode !== undefined) out.rootCode = rootCode
    if (agentCode !== undefined) out.agentCode = agentCode
    if (agentRole !== undefined) out.agentRole = agentRole
    return out
}

/**
 * @description 本轮追活（planned 个新 spawn）预算上过不过：过 ⇒ allow:true；
 * 不过 ⇒ allow:false + 依据 checkBudget 的 degrade/reason 原话（不粉饰成通用"预算不足"）。
 * @param {Object} p
 * @param {Number} p.tokensUsed 该 root 树已消耗（账本现算）
 * @param {Number} p.planned 本轮想开的子任务行数
 * @param {Number} [p.rootTokenCeiling] 天花板（缺省吃 taskBudget 单源 100 万）
 * @param {Number} [p.subtaskCeiling] 子任务上限（同上单源）
 * @returns {{allow:Boolean, degrade:String, reason:String, allowedSubtasks:Number}}
 */
export function budgetAllowsFollow({ tokensUsed = 0, planned = 0, rootTokenCeiling, subtaskCeiling } = {}) {
    if (num(planned) <= 0) return { allow: true, degrade: 'none', reason: 'nothing-to-spawn', allowedSubtasks: 0 }
    const bud = checkBudget({
        rootTokensUsed: num(tokensUsed),
        plannedSubtasks: num(planned),
        rootTokenCeiling: rootTokenCeiling ?? DEFAULT_ROOT_TOKEN_CEILING,
        subtaskCeiling,
    })
    // 闸的语义：预算判定"收回单智能体/开不动"或允许的槽位装不下本轮计划 ⇒ 不追
    const allow = bud.ok && bud.degrade !== 'single-agent' && bud.allowedSubtasks >= num(planned)
    return { allow, degrade: bud.degrade, reason: bud.reason, allowedSubtasks: bud.allowedSubtasks }
}

/**
 * @description 日汇总的 priced 归约——流水线只 $sum 计数，**语义在这判**（可穷举、可被测试真跑）。
 * 三值不是布尔戏法：`true`=当日全部行都明确计价且无一行未计价；`false`=存在未计价行；
 * `null`=当日只有历史/未知计价状态的行——**"无法判定"必须与"未计价"区分**，把 null 演成 false
 * 等于宣称"这些是免费的"，与 priced:false 的"没配价别装钱"是同一纪律的两面。
 * @param {Object} [raw] 聚合行（runs/modelCalls/tokens 各 sum + credits + creditsUnpriced + creditsPricedTrue）
 * @returns {Object} raw 原字段 + {credits, creditsPriced:true|false|null}
 */
export function reduceDailyTotals(raw = {}) {
    const runs = num(raw.runs)
    const unpriced = num(raw.creditsUnpriced)
    const pricedTrue = num(raw.creditsPricedTrue)
    const credits = Math.round((Number(raw.credits) || 0) * 1e6) / 1e6
    let creditsPriced = null
    if (unpriced > 0) creditsPriced = false
    else if (pricedTrue > 0) creditsPriced = true
    // runs=0（空日）与"全未知行"都留在 null：没有计价事实就没有资格说 true/false
    return {...raw, runs, credits, creditsPriced}
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

export default { extractTaskFields, budgetAllowsFollow, reduceDailyTotals, USAGE_AGENT_ROLES }
