/**
 * @fileOverview pass^k / pass@k 评测口径（D32，PR-J 三件套里可离线证明的那件）
 * @module services/core/evals/passK
 * @description
 * D32：**pass^k（k 次全对才算过）为主，pass@k 为辅**——业界 pass^4 的退化数据说明
 * "挑一次最好的"离真实可靠性有多远（§15 口径声明：只采结构性结论）。两个容易做错的点在这里定死：
 * 1. **跑不满 k 次不许报 pass^k=true 也不许报 false**——那是 `insufficient-runs`（数据不足），
 *    按"过"算虚高、按"挂"算冤枉，两种都在教坏调参的人；
 * 2. **单条 run 缺失（null/undefined）记 insufficient，不当"错"**——评测流水线自己掉链子
 *    不该污染被测系统的分数（同"未知不武断"家规）。
 * 配比门槛（§26.2 开工判据"adversarial 60/40"）也在这算——套件级事实放套件级函数。
 */

export const DEFAULT_K = 4  // P1 的裁定：先跑 k=4 看方差再谈 k=8

/**
 * @description 单用例的 k 次结果 ⇒ 通过判定（runs: Boolean|nullable，true=对）
 * @param {Array} runs k 次运行结果
 * @param {Number} [k]
 * @returns {{n:Number,nInsufficient:Number,passAtK:Boolean,passPowK:Boolean|null,verdict:String}} verdict: pass|fail|insufficient-runs
 */
export function caseMetrics(runs = [], k = DEFAULT_K) {
    const list = Array.isArray(runs) ? runs : []
    const n = list.length
    const nInsufficient = list.filter((r) => r === null || r === undefined).length
    const valid = list.filter((r) => r === true || r === false)
    const passes = valid.filter(Boolean).length
    const passAtK = passes >= 1
    if (n < k || nInsufficient > 0) {
        // 跑不满/有缺失：pass^k 无判定（null），pass@k 仍按已知的算但不足以代表可靠性
        return {n, nInsufficient, passAtK, passPowK: null, verdict: 'insufficient-runs'}
    }
    return {n, nInsufficient, passAtK, passPowK: passes === valid.length, verdict: passes === valid.length ? 'pass' : 'fail'}
}

/**
 * @description 套件汇总（cases: [{caseId, adversarial?, runs[]}]）
 * @param {Object[]} cases 用例
 * @param {Object} [opts] {k, minAdversarialShare}
 * @returns {{perCase:Array, totals:Object, mix:Object, gap:Object}} 报告
 */
export function suiteReport(cases = [], opts = {}) {
    const {k = DEFAULT_K, minAdversarialShare = 0.4} = opts
    const perCase = (Array.isArray(cases) ? cases : []).map((c) => ({caseId: c?.caseId ?? '', adversarial: c?.adversarial === true, ...caseMetrics(c?.runs, k)}))
    const judged = perCase.filter((c) => c.verdict !== 'insufficient-runs')
    const passPowKCount = judged.filter((c) => c.passPowK === true).length
    const passAtKCount = perCase.filter((c) => c.passAtK).length
    const nAdversarial = perCase.filter((c) => c.adversarial).length
    const denom = judged.length || 0
    return {
        perCase,
        totals: {
            cases: perCase.length, k,
            sufficient: judged.length,
            insufficient: perCase.length - judged.length,
            passPowKRate: denom ? passPowKCount / denom : null,
            passAtKRate: perCase.length ? passAtKCount / perCase.length : null,
        },
        mix: {adversarial: nAdversarial, task: perCase.length - nAdversarial, adversarialShare: perCase.length ? nAdversarial / perCase.length : 0, minAdversarialShare},
        // reliabilityGap 只在同一批"跑满"的用例上比才诚实——混进不足用例会把差距算成假账
        gap: {reliabilityGap: denom ? (judged.filter((c) => c.passAtK).length - passPowKCount) / denom : null},
    }
}

/**
 * @description 报告是否可作数（§26.2 门槛：配比 + 无不足用例；不达标不是"差"，是**不可比**）
 * @param {Object} report `suiteReport` 产物
 * @returns {{usable:Boolean, reasons:String[]}} 结论
 */
export function reportUsable(report) {
    const reasons = []
    if (!report?.totals?.cases) reasons.push('空套件')
    if (report?.totals?.insufficient > 0) reasons.push(`有 ${report.totals.insufficient} 例未跑满 k=${report.totals.k}（这些例不许计入通过率）`)
    if (report?.mix && report.mix.adversarialShare < report.mix.minAdversarialShare) {
        reasons.push(`adversarial 配比 ${(report.mix.adversarialShare * 100).toFixed(0)}% < 门槛 ${(report.mix.minAdversarialShare * 100).toFixed(0)}%（§26.2 的 60/40）`)
    }
    return {usable: reasons.length === 0, reasons}
}

export default {DEFAULT_K, caseMetrics, suiteReport, reportUsable}
