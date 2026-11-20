/**
 * @fileOverview 分层扇出计划：把带 deps 的子任务清单切成"依赖批次"（PR-任务编排 §8 自适应编排 c1，纯函数）
 * @module services/agent/fanOutPlanGraph
 * @description
 * 设计稿 §8 的 planner 愿景："输出 DAG：{subtasks:[{goal, deps:[...]}]}，deps 空的批次并行、有 deps 的排下一批"。
 * 现网引擎**没有也不该新造 DAG 调度器**（红线"不在 execChat 长第二编排器"，M4 当年明注"不做依赖调度"）——
 * 本件把 DAG **压平成批次序列**：每批内部平铺并行（复用现网 parallel 形状），批次推进交给 finalize/follow
 * 的既有追加机制（layer0 先 spawn，层到终局后由编排层 spawn 下一层）。调度器不存在，"调度"发生在计划里。
 *
 * 性格承 fanOutIntake 的不对称判据：deps 是语义承诺不是格式口癖——
 * - 环引用 ⇒ 整个计划不可信（reject，上层落回普通回答/不带 deps 重拆）；环上的"部分可跑"是假象，
 *   拆半截 DAG 去跑=用错误的执行形状兑现一个没承诺过的语义；
 * - deps 引用不存在的 id ⇒ 同上 reject（引用悬空=模型没按契约点名）；
 * - 层数超 maxLayers ⇒ reject（深链是"sequential 任务伪装成扇出"，并行收益 0、失败面翻倍）。
 * 一切 reject 都如实回 reason，**绝不"修剪依赖硬凑一层"**——修出来的不是模型承诺的图。
 *
 * 向后兼容是本件的第一判据：**全无 deps 的输入 ⇒ 单层计划 layers=[[...全部]]**，
 * 上层拿到的形状与今天逐字一致（现网自包含拆解零行为变化）。
 */

import { checkBudget } from '../core/session/taskBudget.js'

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

/**
 * @description 把 subtasks（可带 id/deps）拓扑分层为批次序列
 * @param {Object} [p]
 * @param {Array}  [p.subtasks] 元素 `{id?, title?, query, deps?:String[]}`；deps=先决子任务的 id 列表
 * @param {Number} [p.maxLayers=3] 层数上限（超=reject；批③预算天花板同源不在这重造并行度/总量闸，只管"链深"）
 * @returns {{ok:Boolean, layers:Array<Array<Object>>, reason:String, cyclic:String[]}}
 *          ok=true：layers[0] 可直接喂 normalizeFanOutPlan/buildRootTask（项含原样 deps，透传纪律不变）；
 *          ok=false：layers=[]，reason ∈ no-subtasks | duplicate-id | unknown-dep | self-dep |
 *                    deps-malformed | cycle | layer-limit；cyclic 带环上 id（诊断用，可空）
 */
export function layerFanOutPlan({ subtasks, maxLayers = 3 } = {}) {
    const list = Array.isArray(subtasks) ? subtasks.filter(Boolean) : []
    if (!list.length) return { ok: false, layers: [], reason: 'no-subtasks', cyclic: [] }

    // id 归一：显式 id 优先；**任何一项带 deps 就必须全员有显式 id**——
    // 混用"title 当隐式键 + deps 引用 id"会让引用语义漂移（title 可空可撞）。
    // 全无 deps ⇒ 不需要 id（兼容面：现网拆解器不产 id，单层直通）。
    const hasDeps = list.some((s) => s.deps !== undefined)
    const ids = list.map((s, i) => String(s.id ?? '').trim())
    if (hasDeps) {
        for (let i = 0; i < list.length; i++) {
            if (!ids[i]) return { ok: false, layers: [], reason: 'unknown-dep', cyclic: [] }
        }
    }
    if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) {
        return { ok: false, layers: [], reason: 'duplicate-id', cyclic: [] }
    }
    const idSet = new Set(ids.filter(Boolean))

    // deps 形状严判：给了就必须是"非空字符串数组"；字符串/对象/含空项都是契约失败
    const depMap = new Map()
    for (let i = 0; i < list.length; i++) {
        const raw = list[i].deps
        if (raw === undefined) { depMap.set(ids[i] || `#${i}`, []); continue }
        if (!Array.isArray(raw) || raw.some((d) => typeof d !== 'string' || !d.trim())) {
            return { ok: false, layers: [], reason: 'deps-malformed', cyclic: [] }
        }
        const deps = raw.map((d) => d.trim())
        for (const d of deps) {
            if (d === ids[i]) return { ok: false, layers: [], reason: 'self-dep', cyclic: [d] }
            if (!idSet.has(d)) return { ok: false, layers: [], reason: 'unknown-dep', cyclic: [d] }
        }
        depMap.set(ids[i] || `#${i}`, deps)
    }

    // Kahn 分层：每轮取"deps 全满足"的批 ⇒ 一层。无进展=有环（诚实报，含残余节点）。
    const keys = list.map((s, i) => ids[i] || `#${i}`)
    const cap = num(maxLayers) || 3
    const done = new Set()
    const layers = []
    while (done.size < keys.length) {
        const batch = []
        const batchKeys = []
        for (let i = 0; i < keys.length; i++) {
            if (done.has(keys[i])) continue
            if ((depMap.get(keys[i]) || []).every((d) => done.has(d))) { batch.push(list[i]); batchKeys.push(keys[i]) }
        }
        if (!batch.length) {
            return { ok: false, layers: [], reason: 'cycle', cyclic: keys.filter((k) => !done.has(k)) }
        }
        batchKeys.forEach((k) => done.add(k))
        layers.push(batch)
        if (layers.length > cap) {
            return { ok: false, layers: [], reason: 'layer-limit', cyclic: [] }
        }
    }

    return { ok: true, layers, reason: layers.length > 1 ? 'layered' : 'flat', cyclic: [] }
}

/** 计划总子任务数（预算闸吃总量不是 layer0——花钱看全树，承 follow"active/all 分账"同族纪律） */
export function planTotals(layers) {
    const arr = Array.isArray(layers) ? layers : []
    const flat = arr.flat().filter(Boolean)
    return { total: flat.length, firstBatch: (arr[0] ? arr[0].length : 0), layers: arr.length }
}

export default { layerFanOutPlan, planTotals, applyLayeredPlan }

/**
 * §8 交叉债清偿：service 3a 的"图严判+预算全总量+盖形状"整段判据抽出为纯函数
 * （recoverCandidate 教训同族——判据住 IO 壳里=从没被执行面直接测过，3a 此前只有
 * 源码位守卫+不可控 e2e）。转调不重算：graph 判定用 layerFanOutPlan、阈值用
 * checkBudget 单源、形状盖 stampChildHandler 单源（注入防 import 环）。
 * 性格：reject 一律整案（reason 带 graph:/budget: 前缀供上层信封归因），**不修剪图**。
 * @param {Object} p
 * @param {Array}  p.subtasks 带 id/deps 的候选层图（parsePlannerOutput 收编形状）
 * @param {Function} p.stamp 形状盖函数（必注入——缺席即编程错误抛出，不静默）
 * @param {Number} [p.rootTokensUsed] 树账已花费（replan 现场传）
 * @returns {{ok:Boolean, reason:String, layers?:Array, firstBatch?:Array, rest?:Array, totals?:Object}}
 */
export function applyLayeredPlan({
    subtasks, stamp, rootTokensUsed = 0,
    subtaskCeiling, rootTokenCeiling, perSubtaskTokenEstimate = 0, degradeRatio, maxLayers = 3,
} = {}) {
    if (typeof stamp !== 'function') throw new Error('applyLayeredPlan: stamp 必填（形状单源被绕开=分叉前夜）')
    const g = layerFanOutPlan({ subtasks, maxLayers })
    if (!g.ok) return { ok: false, reason: `graph:${g.reason}` }
    const totals = planTotals(g.layers)
    const bud = checkBudget({
        rootTokensUsed: Number(rootTokensUsed) > 0 ? Number(rootTokensUsed) : 0,
        plannedSubtasks: totals.total,
        subtaskCeiling, rootTokenCeiling,
        perSubtaskTokenEstimate: Number(perSubtaskTokenEstimate) > 0 ? Number(perSubtaskTokenEstimate) : 0,
        degradeRatio,
    })
    if (!bud.ok || bud.degrade !== 'none' || bud.allowedSubtasks < totals.total) {
        return { ok: false, reason: `budget:${bud.degrade === 'single-agent' ? 'single-agent' : bud.reason}` }
    }
    const stamped = g.layers.map((L) => stamp(L))
    const firstBatch = stamped.shift()
    return { ok: true, layers: stamped, firstBatch, rest: stamped, totals, reason: g.layers.length > 1 ? 'layered' : 'flat' }
}
