/**
 * @fileOverview planner LLM 输出的解析与保守判定（PR-任务编排 M4b c1a，纯函数）
 * @module services/agent/fanOutIntake
 * @description
 * 生成式 planner 跑完一次 LLM 后，把它的输出收成"要不要扇出 + 候选子任务"。这一段的性格必须是**保守**的：
 * 判错方向的代价不对称——把该扇出的漏了，退化成一次普通回答（用户无损失）；把不该扇出的扇了，
 * 用户的一句话被拆成一棵树慢慢长（体验事故）。所以一切模糊都往"不扇"收：
 * - 解析不出合法 JSON ⇒ 不扇（`unparseable`），**绝不猜**；
 * - `needFanOut` 必须严格 `true`（布尔），字符串 "true"/1 都不算——模型没按契约来就是契约失败；
 * - 有效子任务（query 非空）不足 2 ⇒ 不扇（`single-or-empty`）——一个"子任务"就是普通回答，别伪装并行；
 * - 数量先按 `maxInput` 截断（防跑飞输出灌爆下游），真正的额度闸在 `normalizeFanOutPlan`/taskBudget，不在这重造。
 *
 * 转写自现网教训的口味：容忍"围栏包裹/前后有废话"的**格式**脏（strip fence、抠 `{...}`），
 * 但不容忍**语义**脏（字段缺/类型错一律 false）——格式是模型的口癖，语义是它的承诺。
 */

const BRACE_RE = /\{[\s\S]*\}/

/**
 * @description 从 LLM 文本里抠出并解析规划 JSON（容错格式脏，语义严）
 * @param {String} text planner 模型输出原文
 * @param {Object} [opts]
 * @param {Number} [opts.maxInput] 子任务候选的入参截断上限（默认 8；预算闸在 normalizeFanOutPlan，不在此）
 * @returns {{ok:Boolean, needFanOut:Boolean, subtasks:Array, reason:String}}
 *          ok=false 时 needFanOut 必为 false（失败一律收成"不扇"，调用方无脑走普通回答）
 */
export function parsePlannerOutput(text, { maxInput = 8 } = {}) {
    const noFan = (reason) => ({ ok: false, needFanOut: false, subtasks: [], reason })
    if (typeof text !== 'string' || !text.trim()) return noFan('empty-output')

    // 抠 JSON：先去 markdown 围栏，再取第一个 { 到最后一个 }（模型爱在前后加话）
    const stripped = text.replace(/```(?:json)?/gi, '').trim()
    const m = BRACE_RE.exec(stripped)
    if (!m) return noFan('no-json-object')

    let obj
    try {
        obj = JSON.parse(m[0])
    } catch {
        return noFan('unparseable')
    }
    // BRACE_RE 保证 m[0] 是 {...}：parse 出来必是 object，无需再判 array/null

    // 语义严判：needFanOut 必须布尔 true
    if (obj.needFanOut !== true) {
        return { ok: true, needFanOut: false, subtasks: [], reason: typeof obj.reason === 'string' ? obj.reason : 'not-requested' }
    }

    const raw = Array.isArray(obj.subtasks) ? obj.subtasks.filter((s) => s && typeof s === 'object') : []
    const cap = Number(maxInput) > 0 ? Number(maxInput) : 8
    const subtasks = []
    for (const s of raw.slice(0, cap)) {
        const query = String(s.query || '').trim()
        if (!query) continue
        const item = { title: String(s.title || '').trim() || query.slice(0, 30), query }
        // §8 deps/id 原样收编（形状与图的合法性严判**单源在 fanOutPlanGraph**，这里不判第二遍）——
        // 不带 deps 的现网输出零新键，下游逐字兼容。
        const id = String(s.id ?? '').trim()
        if (id) item.id = id
        if (s.deps !== undefined) item.deps = s.deps
        subtasks.push(item)
    }
    // 不足 2 个可独立执行的子任务 ⇒ 这不是扇出，是一次普通回答
    if (subtasks.length < 2) return noFan('single-or-empty')

    return { ok: true, needFanOut: true, subtasks, reason: typeof obj.reason === 'string' ? obj.reason : 'planned' }
}

export default { parsePlannerOutput }
