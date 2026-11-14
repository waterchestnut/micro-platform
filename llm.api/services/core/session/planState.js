/**
 * @fileOverview 计划状态与完成性判据（纯函数，零依赖）——PR-M 地基
 * @module services/core/session/planState
 * @description
 * §10 / D25 要的是"计划外置 + recitation + 完成性反问"：模型自己维护一份 `plan.json`
 * （状态机 `pending/in_progress/done/failed/abandoned`），每次装配把计划**重写到上下文尾部**对抗长循环目标漂移，
 * run 退出前若还有未完结项就触发一次"真的完成了吗"的反问。
 *
 * **本模块只做判据，不接线**（与 `thinkingMode`/`egressPosture` 同一节奏）：
 * 现在线上没有任何行为变化，`update_plan` 工具、recitation 注入、finalizer 反问都在后续独立刀里落地，
 * 每一刀各自可测、各自可回滚。先把"计划到底是个什么形状、怎么算没做完、recitation 怎么截"钉成纯函数，
 * 是因为这三件事一旦被塞进 `execChat` 主循环，就又成了 §2.10 说的那种"700 行零单测、谁都要改却谁都测不动"。
 *
 * 三条贯穿本模块的纪律（都是本档反复写的那类）：
 * 1. **保守归一**：缺失/非法的状态一律按"未完成"处理（`pending`），绝不默认成 `done`——
 *    把"没登记"读成"已完成"就是完成性反问要防的自我高估（同 D36 的"缺 reviewStatus 即 pending"）；
 * 2. **裁剪要声明**：recitation 超预算时显式给"另有 N 项未显示"，不静默丢条目（同 §9 的段裁剪、`segmentSummary`）；
 * 3. **判据与阻断分离**：这里只返回"要不要反问"，真正花不花钱发这次反问由调用方 + 配置开关决定
 *    （同 `decideEgressPosture` 的 `blocks`、`finalizationDecision` 的 `action`）。
 */

import {estimateTokens} from '../../../tools/truncate.js'

/** 计划项状态机（§10 line 821）。值即落库/传输用的稳定字符串，改名要同步前端与存量 */
export const PLAN_STATUS = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    DONE: 'done',
    FAILED: 'failed',
    ABANDONED: 'abandoned',
}

/** 还算"没结"的状态：反问要不要触发看的是这个集合，而不是只看 pending */
export const OPEN_STATUSES = new Set([PLAN_STATUS.PENDING, PLAN_STATUS.IN_PROGRESS])
/** 合法状态全集 */
const ALL_STATUSES = new Set(Object.values(PLAN_STATUS))

/**
 * @description 归一单项状态；缺失或非法一律按 pending（保守：没确认做完就当没做完）
 * @param {String} s 原始状态
 * @returns {String} PLAN_STATUS 之一
 */
export function normalizeStatus(s) {
    const v = String(s || '').trim().toLowerCase()
    return ALL_STATUSES.has(v) ? v : PLAN_STATUS.PENDING
}

/**
 * @description 把模型给的计划载荷归一成可信结构
 * @param {Object|null} raw 形如 `{items: [{id, title, status, ...}]}`
 * @returns {{items: Array, warnings: String[]}} 归一结果与"我替你改了什么"的留痕
 *
 * 为什么不直接信任入参：这是**模型写的**，字段可能缺、类型可能错、id 可能重复。
 * 归一策略全部偏保守且**每次改写都记进 warnings**（不留"悄悄修好"的暗坑）：
 * - 非数组 `items` ⇒ 空清单 + 警告（宁可不注入 recitation，也不编造条目）；
 * - 非对象项 / 无 title 的项 ⇒ 丢弃 + 计数警告；
 * - id 缺失 ⇒ 用序号补一个稳定 id；id 重复 ⇒ 保留首个、丢弃后来者并警告（装配顺序不能因重复 id 抖动）；
 * - status 非法 ⇒ `normalizeStatus` 兜成 pending。
 */
export function normalizePlan(raw) {
    const warnings = []
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) {
        return {items: [], warnings: ['载荷不是带 items 数组的对象，按空计划处理']}
    }
    const items = []
    const seen = new Set()
    raw.items.forEach((it, i) => {
        if (!it || typeof it !== 'object') {
            warnings.push(`第 ${i + 1} 项不是对象，已丢弃`)
            return
        }
        const title = String(it.title ?? '').trim()
        if (!title) {
            warnings.push(`第 ${i + 1} 项缺 title，已丢弃（无标题的待办无法用于完成性核对）`)
            return
        }
        let id = String(it.id ?? '').trim()
        if (!id) {
            id = `item-${i + 1}`
            warnings.push(`第 ${i + 1} 项缺 id，用序号补为 ${id}`)
        }
        if (seen.has(id)) {
            warnings.push(`id 重复：${id}，丢弃后来者（保留首个，保证装配顺序稳定）`)
            return
        }
        seen.add(id)
        const status = normalizeStatus(it.status)
        if (it.status != null && String(it.status).trim().toLowerCase() !== status) {
            warnings.push(`项 ${id} 的 status「${String(it.status).slice(0, 24)}」非法，按 pending 处理`)
        }
        items.push({id, title, status})
    })
    return {items, warnings}
}

/**
 * @description 统计各状态数量与"未结项"
 * @param {Object} plan normalizePlan 的输出（或任何带 items[] 的对象）
 * @returns {{total: Number, byStatus: Object, openCount: Number, pending: Number, inProgress: Number, done: Number, failed: Number, abandoned: Number}} 结果
 */
export function planItemCounts(plan) {
    const items = Array.isArray(plan?.items) ? plan.items : []
    const byStatus = {}
    for (const s of ALL_STATUSES) {
        byStatus[s] = 0
    }
    for (const it of items) {
        const st = normalizeStatus(it?.status)
        byStatus[st] = (byStatus[st] || 0) + 1
    }
    const openCount = byStatus[PLAN_STATUS.PENDING] + byStatus[PLAN_STATUS.IN_PROGRESS]
    return {
        total: items.length,
        byStatus,
        openCount,
        pending: byStatus[PLAN_STATUS.PENDING],
        inProgress: byStatus[PLAN_STATUS.IN_PROGRESS],
        done: byStatus[PLAN_STATUS.DONE],
        failed: byStatus[PLAN_STATUS.FAILED],
        abandoned: byStatus[PLAN_STATUS.ABANDONED],
    }
}

/**
 * @description 是否还有未结项（pending 或 in_progress）
 * @param {Object} plan 计划
 * @returns {Boolean} 结果
 */
export function hasOpenItems(plan) {
    return planItemCounts(plan).openCount > 0
}

/**
 * @description 把计划渲染成"重写回上下文尾部"的紧凑文本（recitation）
 * @param {Object} plan normalizePlan 的输出
 * @param {Object} [opts]
 * @param {Number} [opts.maxChars=1200] 字符软上限（超了按整项丢弃并声明，不切半句）
 * @returns {{text: String, shown: Number, omitted: Number, overBudget: Boolean}} 结果
 *
 * 为什么要 recitation：D25 的原话是对抗"长循环里目标漂移"——把当前计划**逐字重述**在上下文尾部，
 * 比只在开头 system prompt 里写一次更抗遗忘。渲染必须是**确定性**的（同输入同输出），否则没法测、
 * 也没法让模型每轮看到一致的计划视图。
 *
 * 裁剪纪律：预算不够时**整项整项丢**，并在末尾写"另有 N 项未显示"——
 * 绝不静默截断成半条待办（那会让模型以为那就是全部计划），与 §9 段裁剪、truncate 的"告诉模型被裁了多少"同源。
 * 状态符号用纯文本（[done]/[~]…），不引入 emoji，避免在不同 provider 下的字节抖动。
 */
export function renderRecitation(plan, {maxChars = 1200} = {}) {
    const items = Array.isArray(plan?.items) ? plan.items : []
    const counts = planItemCounts(plan)
    const header = `当前计划（完成 ${counts.done}/${counts.total}，未结 ${counts.openCount}）：`
    const SYMBOL = {
        [PLAN_STATUS.PENDING]: '[ ]',
        [PLAN_STATUS.IN_PROGRESS]: '[~]',
        [PLAN_STATUS.DONE]: '[x]',
        [PLAN_STATUS.FAILED]: '[!]',
        [PLAN_STATUS.ABANDONED]: '[-]',
    }
    const budget = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 1200
    const lines = [header]
    let shown = 0
    for (const it of items) {
        const line = `${SYMBOL[normalizeStatus(it?.status)]} ${String(it?.title ?? '').trim()}`
        // 预留一行给可能的"另有 N 项未显示"，所以用 lines.join 后整体估，不逐行估到刚好塞满
        const candidate = [...lines, line].join('\n')
        if (estimateTokens(candidate) > budget && shown > 0) {
            break
        }
        lines.push(line)
        shown++
    }
    const omitted = items.length - shown
    let text = lines.join('\n')
    if (omitted > 0) {
        text += `\n（另有 ${omitted} 项未显示，共 ${items.length} 项）`
    }
    return {text, shown, omitted, overBudget: omitted > 0}
}

/**
 * @description 完成性反问判据：只回答"要不要反问"，不决定是否真的花这次调用
 * @param {Object} [state]
 * @param {Object|null} [state.plan] 当前计划
 * @param {String} [state.loopExit] 循环退出方式：'break'（模型自己收的）/ 'exhausted'（到上限）
 * @param {Boolean} [state.hasAnswer] 本轮是否已有正文
 * @param {Boolean} [state.aborted] 已被中断
 * @param {Boolean} [state.selfCheckEnabled] 配置开关（`finalize.selfCheck`）
 * @returns {{action: 'none'|'self-check', reason: String}} 结果
 *
 * 与 `finalizationDecision` 的分工要说清楚，别混：
 * - `finalizationDecision` 管的是"上限打满又没正文 → 补一次无工具收尾调用"；
 * - **本判据管的是相反的病**：模型**自认为做完了**（正常 break 且有正文），但计划里还有未结项——
 *   这正是"同一模型既做又判会系统性高估"（§10 分离做与判）要拦的那一步。
 * 所以它的触发条件是 `loopExit==='break' && hasAnswer && 有未结项`。
 *
 * 保守取向：没计划（`plan` 为空/无 items）⇒ 不反问（没有可核对的目标，反问是噪音）；
 * 中断 ⇒ 不反问（别在停机/取消上再花钱，同 finalizationDecision 的 aborted 分支）。
 */
export function decideCompletionSelfCheck({
    plan = null, loopExit = 'break', hasAnswer = false, aborted = false, selfCheckEnabled = false,
} = {}) {
    if (!selfCheckEnabled) {
        return {action: 'none', reason: 'disabled'}
    }
    if (aborted) {
        return {action: 'none', reason: 'aborted'}
    }
    const items = Array.isArray(plan?.items) ? plan.items : []
    if (items.length === 0) {
        return {action: 'none', reason: 'no-plan'}
    }
    if (loopExit === 'exhausted') {
        // 到上限的兜底是 finalizationDecision 的职责，不在此重复触发
        return {action: 'none', reason: 'handled-by-finalization'}
    }
    if (!hasAnswer) {
        return {action: 'none', reason: 'no-answer'}
    }
    if (!hasOpenItems(plan)) {
        return {action: 'none', reason: 'plan-complete'}
    }
    return {action: 'self-check', reason: 'open-items'}
}

/**
 * @description 反问时追加给用户提示位的那句话（确定性、含未结项数与前若干标题）
 * @param {Object} plan 当前计划
 * @param {Object} [opts]
 * @param {Number} [opts.maxList=6] 最多列出几项标题
 * @returns {String} 提示文本
 */
export function buildSelfCheckHint(plan, {maxList = 6} = {}) {
    const c = planItemCounts(plan)
    const open = (Array.isArray(plan?.items) ? plan.items : [])
        .filter((it) => OPEN_STATUSES.has(normalizeStatus(it?.status)))
    const cap = Number.isFinite(maxList) && maxList > 0 ? maxList : 6
    const listed = open.slice(0, cap).map((it) => `- ${String(it?.title ?? it?.id ?? '').trim()}`)
    if (open.length > cap) {
        listed.push(`- （另有 ${open.length - cap} 项未列出）`)
    }
    return [
        `你的计划里还有 ${c.openCount} 项未标记完成（共 ${c.total} 项）：`,
        ...listed,
        `这次是收尾前的完成性复核，你**不能再调用工具**，只用文字回答。请二选一：`,
        `- 若确认这些项确实不必再做或已在上面完成，只回复 DONE（不要多写）。`,
        `- 若确有遗漏，回复 CONTINUE，换行后把你本该补充的内容直接写出来（会并入最终答案）。`,
    ].join('\n')
}

/**
 * @description 解析完成性反问的回复，决定"追加补充"还是"保留原答案"（纯函数，判决与写分离）
 * @param {String} text self-check 那次调用的正文
 * @returns {{action: 'discard'|'append', supplement: String, marker: String|null}} 结果
 *
 * 取向是**绝不用不确定的回复去动已有答案**（对应 §10.3 B2 决策 (i)"仅在认错要补充时追加"）：
 * - `CONTINUE` 且换行后**有实际内容** ⇒ append 那段（模型认了遗漏并补上）；
 * - `DONE` / 空 / 认了但没写补充 / 根本不是这两个标记开头的自由文本 ⇒ discard，保留原答案。
 *   最后这条是关键：模型不总是守格式，**不守格式时必须倒向"别搞坏已经写好的答案"**，
 *   而不是猜它想补充然后拼一段无关文字进去。
 *
 * 只认**开头**的 DONE/CONTINUE（去掉前后空白、允许跟标点），大小写不敏感；不扫描正文中段，
 * 免得答案里恰好出现"done"字样被误判。补充分隔用第一个换行，marker 之后的同行文字若为空也算没补充。
 */
export function interpretSelfCheckReply(text) {
    const s = String(text ?? '').trim()
    const m = /^(DONE|CONTINUE)\b[\s.:：、,，]*([\s\S]*)$/i.exec(s)
    if (!s || !m) {
        // 空 / 不是以 DONE|CONTINUE 开头（模型没守格式）⇒ 保守 discard，绝不动已有答案
        return {action: 'discard', supplement: '', marker: null}
    }
    const marker = m[1].toUpperCase()
    const rest = String(m[2] || '').trim()
    if (marker === 'DONE') {
        return {action: 'discard', supplement: '', marker}
    }
    // CONTINUE：只有真的带了补充内容才 append；只写了个 CONTINUE 没下文 = 没补，保留原答案
    if (!rest) {
        return {action: 'discard', supplement: '', marker}
    }
    return {action: 'append', supplement: rest, marker}
}

export default {
    PLAN_STATUS, OPEN_STATUSES, normalizeStatus, normalizePlan, planItemCounts, hasOpenItems,
    renderRecitation, decideCompletionSelfCheck, buildSelfCheckHint, interpretSelfCheckReply,
}
