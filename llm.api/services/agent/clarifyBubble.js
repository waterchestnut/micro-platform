/**
 * @fileOverview 子任务澄清冒泡判据（§7-1，纯函数族）
 * @module services/agent/clarifyBubble
 * @description
 * 设计 :113/:142 的兑现："子任务不得向用户出题挂起（卡树）；需澄清一律冒泡到 root 统一出题"。
 * root 在编排形态下**没有活 run**——MRTR 的进程内挂起在这里没有挂靠对象，所以"统一出题"落
 * 成**持久态**：child 申报（终局附问题）→ finalize 截胡挂 hold → detail 可见 → /clarifyAnswer
 * 收答复 → child 带补充重跑 → finalize 重算。每一跳都是可重启的账，没有内存 promise 赌进程活着。
 *
 * 三条纪律：
 * 1. **child 不等待**：申报工具恒 ack"请收尾"——树不该为一问悬着，答复属于下一轮（重派发）；
 * 2. **答复是输入不是续体**：重跑的 query=原 query+【澄清补充】段**替换不叠加**（多轮答复不累积
 *    成楼）；这不同于 ask_user 的密封续体——那边"同轮恢复"，这边"新一轮带新材料"，语义不同不强并；
 * 3. **cap 防"每轮都问"**：同一 child 澄清重跑超上限 ⇒ 如实放弃等待直接综合（note 带
 *    clarify-cap-exhausted），宁可成品带瑕疵，不许树悬死——与 followSpawnCap/预算闸同一取向。
 */

export const CLARIFY_TOOL_NAME = 'request_clarification'
export const CLARIFY_CAP_DEFAULT = 2
/** 问题与选项的长度/数量界（申报会被持久化并显示给用户，宽进也要有顶） */
export const QUESTION_MAX_CHARS = 500
export const OPTIONS_MAX_COUNT = 6
export const OPTION_MAX_CHARS = 100
/** query 注入段的识别标记（替换式注入靠它，防多轮累积） */
export const CLARIFY_SECTION_MARK = '【澄清补充'

/**
 * @description 构造 request_clarification 工具定义（child 专用申报面）
 * @returns {Object[]} tools 数组片段
 */
export function buildClarifyRequestTools() {
    return [{
        type: 'function',
        function: {
            name: CLARIFY_TOOL_NAME,
            description: [
                '向主任务申报一个"需要用户澄清"的问题：它不会现在得到答案——',
                '申报后请基于已知信息完成本轮工作并在正文标注假设；用户的补充答复会随任务的下一轮交回。',
                'question 必须一句话说清缺什么；options 给候选（可空，最多 ' + OPTIONS_MAX_COUNT + ' 项）。',
            ].join(''),
            parameters: {
                type: 'object',
                properties: {
                    question: {type: 'string', description: `要向用户澄清的问题（≤${QUESTION_MAX_CHARS} 字）`},
                    options: {type: 'array', description: '候选项（可选）', items: {type: 'string'}},
                },
                required: ['question'],
            },
        },
    }]
}

/**
 * @description 是否 request_clarification 工具
 * @param {String} toolName 工具名
 * @returns {Boolean}
 */
export function isClarifyRequestTool(toolName) {
    return toolName === CLARIFY_TOOL_NAME
}

/**
 * 申报参数校验（拒形回原因，不硬猜——超长不是截断的理由，模型重写一句短的更诚实）。
 * @param {String|Object} args toolCall.arguments（JSON 串或对象）
 * @returns {{ok: Boolean, question?: String, options?: String[], reason?: String}}
 */
export function parseClarifyRequest(args) {
    let a = args
    if (typeof a === 'string') {
        try { a = JSON.parse(a || '{}') } catch { return {ok: false, reason: 'bad-json'} }
    }
    if (!a || typeof a !== 'object') return {ok: false, reason: 'bad-shape'}
    const question = typeof a.question === 'string' ? a.question.trim() : ''
    if (!question) return {ok: false, reason: 'empty-question'}
    if (question.length > QUESTION_MAX_CHARS) return {ok: false, reason: 'question-too-long'}
    let options = []
    if (a.options !== undefined && a.options !== null) {
        if (!Array.isArray(a.options)) return {ok: false, reason: 'options-not-array'}
        options = a.options.map((o) => String(o ?? '').trim()).filter(Boolean)
        if (options.length > OPTIONS_MAX_COUNT) return {ok: false, reason: 'options-too-many'}
        if (options.some((o) => o.length > OPTION_MAX_CHARS)) return {ok: false, reason: 'option-text-too-long'}
    }
    return {ok: true, question, options}
}

/**
 * 从汇聚后的 children 里提取有效申报（finalize 的输入面）。
 * 只认终局成功行（handleStatus===2）且 clarify.question 非空的——失败行附带的"想问"不是澄清，
 * 是失败叙事的一部分（arbitrate 的面，冒泡不该给它出题权）。
 * @param {Array} children 汇聚子行 [{agentCode, handleStatus, handleRet, title}]
 * @returns {Array<{agentCode: String, question: String, options: String[], title: String}>}
 */
export function extractClarifyRequests(children = []) {
    const out = []
    for (const c of (Array.isArray(children) ? children : [])) {
        if (!c || c.handleStatus !== 2) continue
        const cl = c.handleRet?.clarify
        const question = typeof cl?.question === 'string' ? cl.question.trim() : ''
        if (!question) continue
        out.push({
            agentCode: c.agentCode || '', question,
            options: Array.isArray(cl.options) ? cl.options : [],
            title: c.title || '',
        })
    }
    return out
}

/**
 * finalize 结果上的澄清截胡（接线层在 synthesize 之前问它，判据单源）。
 * - 非 synthesize 档 ⇒ 原样直通（report/retry/replan 各有自己的真话，澄清不借道）；
 * - 有待答申报（含 answered 收缩后仍有）⇒ await：给出 hold 形状；
 * - 申报全部超限 ⇒ synthesize-degraded：转综合但 note 如实（cap 用尽不是"没问题"）；
 * - 全被答复过（hold 清空且这轮没有新申报）⇒ 照常 synthesize。
 * @param {Object} p
 * @param {Object} p.fin finalizeFanOutRoot/runFollowLoop 的最终结果
 * @param {Array} p.requests extractClarifyRequests 的产物（本轮新申报）
 * @param {Array} [p.answeredCodes] root.params.clarifyHold 里已答复的 agentCode
 * @param {Object} [p.clarifyCounts] {agentCode: 已重跑次数}
 * @param {Number} [p.cap]
 * @returns {{mode: 'passthrough'|'await'|'synthesize-degraded', fin?: Object, hold?: Object, note?: String}}
 */
export function decideFinalizeWithClarify({fin = null, requests = [], answeredCodes = [], clarifyCounts = {}, cap = CLARIFY_CAP_DEFAULT} = {}) {
    if (!fin || fin.action !== 'synthesize') return {mode: 'passthrough', fin}
    const answered = new Set(answeredCodes.filter(Boolean))
    const overCap = (agentCode) => (Number(clarifyCounts?.[agentCode]) || 0) >= cap
    const pending = requests.filter((r) => r.agentCode && !answered.has(r.agentCode))
    if (pending.length === 0) return {mode: 'passthrough', fin}
    const waiting = pending.filter((r) => !overCap(r.agentCode))
    if (waiting.length === 0) {
        return {mode: 'synthesize-degraded', fin, note: 'clarify-cap-exhausted'}
    }
    return {
        mode: 'await',
        hold: {
            requests: waiting.map((r) => ({agentCode: r.agentCode, question: r.question, options: r.options, title: r.title})),
            // 超限的如实挂在 hold 的说明位（detail 能看到"有一问不再等答复了"，不是静默丢）
            capped: pending.filter((r) => overCap(r.agentCode)).map((r) => ({agentCode: r.agentCode, question: r.question})),
            sealedAt: new Date().toISOString(),
        },
    }
}

/**
 * 答复与挂起清单的对表（端点输入归一）。允许**部分答复**——答一个重派一个，没答的继续挂着；
 * unknown（清单外的 agentCode）如实列出但不拦（用户多答不可能是错）。
 * @param {Object} p
 * @param {Object} p.hold root.params.clarifyHold
 * @param {Array} p.answers [{agentCode, response}]
 * @returns {{matched: Array<{agentCode: String, question: String, response: String}>, unknown: String[], missing: String[], empty: Boolean}}
 */
export function matchClarifyAnswers({hold = null, answers = []} = {}) {
    const reqBy = new Map((hold?.requests || []).map((r) => [r.agentCode, r]))
    const matched = []
    const unknown = []
    const used = new Set()
    for (const a of (Array.isArray(answers) ? answers : [])) {
        const code = String(a?.agentCode || '')
        const response = String(a?.response ?? '').trim()
        if (!reqBy.has(code)) { unknown.push(code || '(缺agentCode)'); continue }
        if (!response) { unknown.push(`${code}(空答复)`); continue }
        matched.push({agentCode: code, question: reqBy.get(code).question, response})
        used.add(code)
    }
    const missing = (hold?.requests || []).filter((r) => !used.has(r.agentCode)).map((r) => r.agentCode)
    return {matched, unknown, missing, empty: matched.length === 0}
}

/**
 * 澄清后的 child 重派 query：注入段**替换不叠加**（同一 child 第二次答复时，旧的【澄清补充…】段
 * 整段被新的取代；多轮材料累积交给答复文本自己带，账上不叠楼）。
 * @param {Object} p
 * @param {String} p.query child 现行 params.query
 * @param {String} p.response 本次答复
 * @param {Number} [p.round] 第几轮澄清（标记用，1 起）
 * @returns {{query: String}}
 */
export function buildClarifyRequeueParams({query = '', response = '', round = 1} = {}) {
    const base = String(query || '')
    const markAt = base.indexOf(CLARIFY_SECTION_MARK)
    const head = markAt >= 0 ? base.slice(0, markAt).replace(/\s+$/, '') : base
    const section = `${CLARIFY_SECTION_MARK} · 第 ${round} 轮】\n用户答复：${String(response || '').trim()}`
    return {query: `${head}\n\n${section}`}
}

export default {
    CLARIFY_TOOL_NAME, CLARIFY_CAP_DEFAULT, QUESTION_MAX_CHARS, OPTIONS_MAX_COUNT, OPTION_MAX_CHARS,
    CLARIFY_SECTION_MARK, buildClarifyRequestTools, isClarifyRequestTool, parseClarifyRequest,
    extractClarifyRequests, decideFinalizeWithClarify, matchClarifyAnswers, buildClarifyRequeueParams,
}
