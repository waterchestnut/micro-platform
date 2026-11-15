/**
 * @fileOverview 执行器门第 1 层的判据（D18 四层门："显式规则"那一层；纯函数，判据先行）
 * @module services/core/session/execGate
 * @description
 * D18 把 ~~人审门~~ 重写成四层：**显式规则 → 动作分类器 → 计划级一次性授权 → 兜底回落人工**，
 * 且"覆盖范围必须含文件写/产物上传/沙箱代码，不只 gate shell"。本模块只做**第 1 层与第 4 层的预算判据**：
 *   - `classifyAction`：动作 → {surface, families, malformed}（暴露面与动词族的**权威定义处**——
 *     P-11 普查器从这里 import，不再自持词表；两处一份理解就是分家，这次在出生时掐掉）；
 *   - `decideLayer1`：规则表命中判定（deny 先查、allow 后查、都不中 ⇒ continue 交给下一层）；
 *   - `decideGateFallback`：分类器连续无法裁决与 per-run 预算的保险丝判据。
 * 分类器（第 2 层，等 P-11 选型）、计划级授权（第 3 层，等 §2F.4 裁定"审批只接受发起人"）、
 * 主循环接线（execChat 的门位）**都不在本件**——照 sleepTime/K2/X 的家族节奏：判据离线钉死，接线等窗口。
 *
 * 三条设计决定（都有出处）：
 * 1. **空清单=合法空（拒绝侧），不是全允许**：`allow:[]` 是"没有规则"，任何动作都 continue；
 *    "全允许"必须写一条显式空条件规则（rule 的 tools/surfaces/families 全空=any）——
 *    权力的表达要费劲，误配置才不会静默开闸（grpcSkill 列表键 "[]" 同族惯例）。
 * 2. **malformed 入参不许走族条件命中**：解析不了的参数正是伪装的机会（census 教训的形状），
 *    按族写的 allow/deny 对它一律不匹配 ⇒ 流向下一层裁决；仅按工具名的规则可以命中，
 *    但 reason 带 malformed 警示——放行可以，**装作没看见畸形不行**。
 * 3. **第 1 层的 allow/deny 都是终局**（D18 的顺序语义：显式规则命中就不进分类器——
 *    花分类器的钱去推翻白纸黑字是浪费也是漂移面），continue 是唯一非终局。
 */

/** 工具名 → 门暴露面（D18"覆盖不只 shell"的枚举面；未列出=unknown，unknown 永不默认放行） */
export const GATE_SURFACES = {
    run_code: 'shell',
    save_artifact: 'artifact-upload',
    read_artifact: 'artifact-read',
    get_website: 'network-fetch',
    search_web: 'network-fetch',
    memory_save: 'state-write',
    memory_search: 'state-read',
    memory_get: 'state-read',
    read_tool_result: 'meta',
    get_current_datetime: 'meta',
    update_plan: 'plan',
    ask_user: 'ask',
}

/**
 * @description run_code 等正文动作的动词族（固定词表；**只判不回显原文**——普查器同款纪律）。
 * 族集是规则表的字母表：D18 的"文件写/产物上传/沙箱代码"覆盖要求在这里成为可点名对象。
 * 词表来源与校准：p11-action-census 的自然流量读数（2026-11-15）。
 */
export const VERB_FAMILIES = [
    ['file-write', /(open\s*\([^)]*['"][wax]|\.write_text|\.write\s*\(|>>|>\s*\S|tee\s|mkdir|touch|mv\s|cp\s|chmod)/i],
    ['file-delete', /(\brm\s|rimraf|unlink|rmtree|os\.remove|shutil\.rmtree|\.delete\()/i],
    ['network', /(curl|wget|requests\.|urllib|httpx|fetch\(|socket)/i],
    ['package-install', /(pip install|npm install|apt|yum )/i],
    ['process', /(subprocess|os\.system|exec\s*\(|popen)/i],
]

/**
 * @description 动作归一（判据输入）
 * @param {Object} p {toolName, argsText} argsText 容忍 字符串/对象/缺失
 * @returns {{toolName:String, surface:String, families:String[], malformed:Boolean}}
 */
export function classifyAction({toolName, argsText} = {}) {
    const name = String(toolName || '')
    let text = ''
    let malformed = false
    if (typeof argsText === 'string') {
        text = argsText
    } else if (argsText && typeof argsText === 'object') {
        try {
            text = JSON.stringify(argsText)
        } catch {
            malformed = true
        }
    } else if (argsText !== undefined && argsText !== null && argsText !== '') {
        malformed = true
    }
    const families = []
    if (!malformed && text) {
        for (const [fam, re] of VERB_FAMILIES) {
            if (re.test(text)) {
                families.push(fam)
            }
        }
    }
    return {toolName: name, surface: GATE_SURFACES[name] || 'unknown', families, malformed}
}

/**
 * @description 单条规则命中判定（tools/surfaces/families 三条件 AND；空条件=any）
 * @param {Object} action classifyAction 的产物
 * @param {Object} rule {id?, tools?:String[], surfaces?:String[], families?:String[]}
 * @returns {Boolean}
 */
export function matchRule(action, rule = {}) {
    if (!action || !rule) {
        return false
    }
    if (Array.isArray(rule.tools) && rule.tools.length && !rule.tools.includes(action.toolName)) {
        return false
    }
    if (Array.isArray(rule.surfaces) && rule.surfaces.length && !rule.surfaces.includes(action.surface)) {
        return false
    }
    if (Array.isArray(rule.families) && rule.families.length) {
        /** 决定 2：malformed 不许走族条件——按族推断的前提（能读懂正文）已经不成立 */
        if (action.malformed) {
            return false
        }
        if (!rule.families.some((f) => action.families.includes(f))) {
            return false
        }
    }
    return true
}

/**
 * @description 第 1 层裁决：deny 先查、allow 后查、无命中 ⇒ continue（交分类器层）
 * @param {Object} action classifyAction 的产物
 * @param {Object} [rules] {allow: Object[], deny: Object[]}
 * @returns {{verdict:String, final:Boolean, reason:String, matchedRule:String|null}}
 */
export function decideLayer1(action, rules = {}) {
    const deny = Array.isArray(rules.deny) ? rules.deny : []
    const allow = Array.isArray(rules.allow) ? rules.allow : []
    for (const r of deny) {
        if (matchRule(action, r)) {
            return {verdict: 'deny', final: true, reason: `rule-deny${r.id ? `:${r.id}` : ''}`, matchedRule: r.id || null}
        }
    }
    for (const r of allow) {
        if (matchRule(action, r)) {
            const warn = action.malformed ? '（malformed-args：按工具名命中，族推断未参与）' : ''
            return {verdict: 'allow', final: true, reason: `rule-allow${r.id ? `:${r.id}` : ''}${warn}`, matchedRule: r.id || null}
        }
    }
    /** 空清单走到这里：allow:[] 不是全允许（决定 1），unknown 工具也走到这里等下层裁决——永不默认放行 */
    return {verdict: 'continue', final: false, reason: 'no-rule-match', matchedRule: null}
}

/**
 * @description 第 4 层保险丝判据：连续无法裁决 & per-run 预算（§19 草图的 fallback:{consecutive:3, perRun:20}）
 * @param {Object} p 参数
 * @param {String[]} [p.recentVerdicts] 本 run 的门裁决序列（从旧到新；'escalate'=分类器也无法裁决）
 * @param {Number} [p.consecutive] 连续 escalate 达到它就转人工（<=0 关闭该保险丝）
 * @param {Number} [p.perRunBudget] 本 run 门决策总数上限，到了就转人工（<=0 关闭）
 * @param {Number} [p.gateDecisionsThisRun] 本 run 已做的门决策数
 * @returns {{route:String, reason:String, consecutiveEscalations:Number}} route: classifier|human
 *
 * 预算转人工的理由与 consecutive 同族：分类器是花钱的（P-11 量的就是这个），
 * 无上限的"拿不准就分类"= 成本失控 + 把兜底变主路。
 */
export function decideGateFallback({recentVerdicts = [], consecutive = 3, perRunBudget = 20, gateDecisionsThisRun = 0} = {}) {
    const list = Array.isArray(recentVerdicts) ? recentVerdicts : []
    let tail = 0
    for (let i = list.length - 1; i >= 0 && list[i] === 'escalate'; i--) {
        tail++
    }
    if (perRunBudget > 0 && gateDecisionsThisRun >= perRunBudget) {
        return {route: 'human', reason: `per-run-budget:${gateDecisionsThisRun}/${perRunBudget}`, consecutiveEscalations: tail}
    }
    if (consecutive > 0 && tail >= consecutive) {
        return {route: 'human', reason: `consecutive-escalations:${tail}`, consecutiveEscalations: tail}
    }
    return {route: 'classifier', reason: 'budget-ok', consecutiveEscalations: tail}
}

export default {GATE_SURFACES, VERB_FAMILIES, classifyAction, matchRule, decideLayer1, decideGateFallback}
