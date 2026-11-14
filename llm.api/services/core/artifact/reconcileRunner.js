/**
 * @fileOverview 对账执行核（reconcile 的"动手"半边；deps 全注入，默认干跑）
 * @module services/core/artifact/reconcileRunner
 * @description
 * §9.5 说"孤儿由 reconcile.js 双向对账"，artifactReconcile 给了**分类判据**（只分类不动手）；
 * 本模块是动手侧的执行核：取数行 → 核验注入 → classifyArtifact → 按白名单执行/延期。
 * 三道闸门，一道比一道紧：
 * 1. **默认干跑**（enforce=false）：完整跑分类与核验，外部动作一个不做，plans 里如实列"如果开闸会做什么"——
 *    同 census/retention 的"先有数，扳机交有权限的人"。
 * 2. **动作白名单**：即便 enforce=true，只执行 AUTO_ACTIONS 里的动作。判据词表里带 `?` 的
 *    （`unregister-artifact?`=悬空记录要不要注销属产品判断）**永不自动执行**，进 deferred 交人工；
 *    `verify-doc-api` 是"本轮核验没成、下轮再验"的观测性动作，同样 deferred（不许自我循环重试）。
 * 3. **行级故障隔离**：一行的核验/执行抛错只脏那一行（记 errors、存在性按 unknown 判据走——
 *    "未知不武断"是 classifyArtifact 的既有纪律），批次继续。
 *
 * 生产接线（dac 取数 + doc.api 存在性核验的真实现 + cron 部署块）**不在本模块**：
 * doc.api 的存在性核验方法我们**尚未实测**（download 是否支持 Range/HEAD 未知），没有实测就不写"默认实现"——
 * 这正是要害处留注入的理由。对账 cron 那刀拿到窗口后：传 dac.scanStalled 的行 + 实测过的 verify 进来即可。
 */

import {classifyArtifact, RECONCILE_CLASS} from './artifactReconcile.js'

/** enforce=true 时允许**自动执行**的动作白名单。加动作必须过一道脑：误执行的代价可逆吗？ */
export const AUTO_ACTIONS = ['mark-broken', 'mark-dangling', 'delete-doc-api-file', 'drop-allocation-ledger', 'notify']

/** 已终结的账行不再对账（rolled-back=补偿完成，status=-1=已注销） */
const SETTLED_STATES = ['rolled-back']

/**
 * @description 把一行 artifact 账折算成 classifyArtifact 的输入
 * @param {Object} row dac 行（artifactCode/state/fileCode/insertTime/status...）
 * @param {Number} now 批次时间戳
 * @param {Number} graceMs 宽限期
 * @param {Object} verified {docFilePresent:Boolean|undefined, referencedByMessage:Boolean}
 * @returns {Object} classify 输入
 */
export function rowToClassifyInput(row = {}, {now = Date.now(), graceMs = 0} = {}, verified = {}) {
    const registered = ['registered', 'ready'].includes(row.state)
    const allocated = Boolean(row.fileCode)
    const insertedAt = row.insertTime ? new Date(row.insertTime).getTime() : now
    return {
        registered,
        allocated,
        docFilePresent: verified.docFilePresent, // undefined=核验不了 ⇒ 判据端"未知不武断"
        referencedByMessage: Boolean(verified.referencedByMessage),
        ageMs: Math.max(0, now - insertedAt),
        graceMs,
    }
}

/**
 * @description 跑一批对账（顺序执行：批次小、审计要行序稳定可复现，不搞并发花活）
 * @param {Object} params 入参
 * @param {Object[]} params.rows dac.scanStalled 等取来的账行（含非终态与 failed 行；SETTLED/-1 会被跳过）
 * @param {Object} [params.opts] {graceMs, now, enforce}
 * @param {Object} deps 注入面
 * @param {Function} [deps.verifyDocFile] (fileCode) => Promise<Boolean|null> doc.api 存在性核验（抛/给空=未知）
 * @param {Function} [deps.isReferenced] (row) => Promise<Boolean> message 引用核验
 * @param {Function} [deps.markIntegrity] (artifactCode, 'broken'|'dangling') 完整性标记回写
 * @param {Function} [deps.deleteDocFile] (artifactCode, fileCode) 回收 doc.api 对象（生产=tombstone）
 * @param {Function} [deps.dropAllocation] (artifactCode) 清分配账
 * @param {Function} [deps.notify] (payload) 通报
 * @returns {Promise<Object>} {counts, plans, executedAll, dryRun}
 */
export async function runReconcilePass({rows = [], opts = {}, deps = {}} = {}) {
    const {graceMs = 10 * 60 * 1000, now = Date.now(), enforce = false} = opts
    const plans = []
    const counts = {}
    for (const k of Object.values(RECONCILE_CLASS)) counts[k] = 0
    let skipped = 0

    for (const row of Array.isArray(rows) ? rows : []) {
        if (SETTLED_STATES.includes(row?.state) || row?.status === -1) {
            skipped++
            continue
        }
        const plan = {artifactCode: row?.artifactCode || '', klass: '', actions: [], executed: [], deferred: [], errors: []}
        // 核验：拿不到就当未知（classifyArtifact 对 undefined 的判法是既定的，这里不替它猜）
        let docFilePresent
        if (row?.fileCode && typeof deps.verifyDocFile === 'function') {
            try {
                const v = await deps.verifyDocFile(row.fileCode)
                docFilePresent = v === true ? true : (v === false ? false : undefined)
            } catch (e) {
                plan.errors.push(`verifyDocFile: ${String(e?.message || e).slice(0, 120)}`)
            }
        }
        let referenced = false
        if (typeof deps.isReferenced === 'function') {
            try {
                referenced = Boolean(await deps.isReferenced(row))
            } catch (e) {
                plan.errors.push(`isReferenced: ${String(e?.message || e).slice(0, 120)}`)
                // 引用核验失败 ⇒ 按**已引用**对待：保护优先于回收（误删被引用产物的代价不可逆，误延一次回收可逆）
                referenced = true
                plan.errors.push('按 referenced=true 保守处理')
            }
        }
        const input = rowToClassifyInput(row, {now, graceMs}, {docFilePresent, referencedByMessage: referenced})
        const cls = classifyArtifact(input)
        plan.klass = cls.klass
        plan.note = cls.note
        plan.actions = cls.actions.slice()
        counts[cls.klass]++

        for (const action of cls.actions) {
            const autoable = AUTO_ACTIONS.includes(action)
            if (!autoable) {
                plan.deferred.push(action) // 带 ? 的判断类/观测类动作：永远只列不做
                continue
            }
            if (!enforce) {
                plan.deferred.push(`${action}(dry-run)`)
                continue
            }
            const fn = {
                'mark-broken': () => deps.markIntegrity?.(plan.artifactCode, 'broken'),
                'mark-dangling': () => deps.markIntegrity?.(plan.artifactCode, 'dangling'),
                'delete-doc-api-file': () => deps.deleteDocFile?.(plan.artifactCode, row.fileCode),
                'drop-allocation-ledger': () => deps.dropAllocation?.(plan.artifactCode),
                'notify': () => deps.notify?.({artifactCode: plan.artifactCode, klass: cls.klass, note: cls.note}),
            }[action]
            try {
                if (!fn) throw new Error('动作没有对应执行器')
                await fn()
                plan.executed.push(action)
            } catch (e) {
                plan.errors.push(`${action}: ${String(e?.message || e).slice(0, 120)}`)
            }
        }
        plans.push(plan)
    }
    const executedAll = plans.reduce((s, p) => s + p.executed.length, 0)
    return {counts, plans, skippedSettled: skipped, executedAll, dryRun: !enforce}
}

export default {AUTO_ACTIONS, rowToClassifyInput, runReconcilePass}
