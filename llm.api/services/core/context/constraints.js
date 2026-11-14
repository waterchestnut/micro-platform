/**
 * @fileOverview pinned constraints 的归一/筛选/渲染（D22 / PR-T0 治理腿，§12 指定文件）
 * @module services/core/context/constraints
 * @description
 * §5.2 line 688 的三不原则：**摘要器永不重写、装配永不丢弃、每步重载**。本模块是它的可执行形态：
 * - `normalizeConstraint`：§7 line 729 结构的入册把关（词表封闭、时刻一致、授权人必须实名——
 *   "谁给的权限"匿名了，治理就无从谈起，同 E0.1 的归属精神）；
 * - `selectActiveConstraints`：按 scope/有效期筛本轮该重载的；**scope:'channel' 如实 deferred**
 *   ——§7 行结构只有 conversationCode、没有 channel 字段，替它发明字段=在判据里夹私货，
 *   要支持得先回方案补结构定义（这里不装懂）；
 * - `renderConstraints`：逐字渲染 + **整条进槽/整条出槽**——约束被截半比不被渲染更危险
 *   （半句"允许访问 /workspace"与"不允许…"只差几刀）。槽预算装不下时 permission 类被延后
 *   记 violations：宁可整条缺席并报警，不可静默降权。
 *
 * 读写介质（extInfo vs 独立集合）与装配注入（llmChat 槽位）都不在本模块——§7 line 728 本就写着"或"，
 * 存储选型要跟真实写入方一起定才有依据；本刀交付的是存储无关的判据 + 注入式 store 的形状约定。
 */

/** §7 line 729 的封闭词表（装配/渲染/校验共用，测试钉漂移） */
export const CONSTRAINT_SCOPES = ['turn', 'session', 'channel']
export const CONSTRAINT_KINDS = ['permission', 'commitment', 'rule']

/** 槽内次序：授权类先（丢了最危险）→ 承诺 → 规则；同 kind 先授权先（at 升序）；再按 code 定序可复现 */
const KIND_RANK = {permission: 0, commitment: 1, rule: 2}

const toMs = (v) => {
    if (v === null || v === undefined || v === '') return null
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
    return Number.isFinite(t) ? t : null
}

/**
 * @description 入册把关：归一 + 拒绝非法（纯函数，标识经注入 genCode——同 save_artifact 纪律）
 * @param {Object} input 原始约束
 * @param {Object} [opts] {genCode, now, textMaxChars}
 * @returns {{ok:Boolean, value?:Object, error?:String}} 归一结果
 */
export function normalizeConstraint(input = {}, opts = {}) {
    const {genCode, now = Date.now(), textMaxChars = 500} = opts
    if (typeof genCode !== 'function') return {ok: false, error: 'normalizeConstraint 需要注入 genCode'}
    const text = String(input.text ?? '').trim()
    if (!text) return {ok: false, error: 'text 不能为空（约束得有可逐字复述的内容）'}
    // 单行卫生：含换行的"约束"能在渲染槽里伪造 `- [permission]` 行——D22 治篡改，入口先不许夹带
    if (/[\r\n\t\0]/.test(text)) return {ok: false, error: 'text 不能含换行/制表符（逐字渲染按行注入，夹带行=伪造约束）'}
    if (text.length > textMaxChars) return {ok: false, error: `text 超过 ${textMaxChars} 字符上限`}
    const scope = input.scope === undefined || input.scope === null ? 'session' : String(input.scope)
    if (!CONSTRAINT_SCOPES.includes(scope)) return {ok: false, error: `scope=${JSON.stringify(input.scope)} 不在 ${CONSTRAINT_SCOPES.join('|')}`}
    const kind = input.kind === undefined || input.kind === null ? 'rule' : String(input.kind)
    if (!CONSTRAINT_KINDS.includes(kind)) return {ok: false, error: `kind=${JSON.stringify(input.kind)} 不在 ${CONSTRAINT_KINDS.join('|')}`}
    const userCode = String(input.grantedBy?.userCode ?? '').trim()
    if (!userCode) return {ok: false, error: 'grantedBy.userCode 必填：匿名授权无法追责，治理意义为零'}
    const nowMs = toMs(now) ?? Date.now()
    const grantedAt = toMs(input.grantedBy?.at) ?? nowMs
    let expiresAt = null
    if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
        const e = toMs(input.expiresAt)
        if (e === null) return {ok: false, error: 'expiresAt 不是可比时刻'}
        if (e <= grantedAt) return {ok: false, error: 'expiresAt 必须晚于授权时刻（授出即过期是笔误不是约束）'}
        if (e <= nowMs) return {ok: false, error: 'expiresAt 已在过去：这条约束从未生效，别入册'}
        expiresAt = new Date(e)
    }
    const conversationCode = String(input.conversationCode ?? '').trim()
    if (scope !== 'channel' && !conversationCode) {
        return {ok: false, error: `scope=${scope} 必须绑定 conversationCode`}
    }
    return {
        ok: true,
        value: {
            constraintCode: String(input.constraintCode || genCode('cst')),
            conversationCode,
            scope,
            kind,
            text,
            grantedBy: {userCode, at: new Date(grantedAt)},
            expiresAt,
            sourceMessageCode: input.sourceMessageCode ? String(input.sourceMessageCode) : '',
        },
    }
}

/** 排序是裁定不是巧合：permission→commitment→rule，同 kind 先授权先，再按 code 定序。
 *  select 用它排产出，render 也用它兜底（防"绕过 select 直接喂"的调用方让 rule 挤掉 permission）——一个裁定，两处共用。 */
export function compareConstraints(a, b) {
    const ka = (KIND_RANK[a?.kind] ?? 9) - (KIND_RANK[b?.kind] ?? 9)
    if (ka !== 0) return ka
    const ta = (toMs(a?.grantedBy?.at) ?? 0) - (toMs(b?.grantedBy?.at) ?? 0)
    if (ta !== 0) return ta
    return String(a?.constraintCode ?? '').localeCompare(String(b?.constraintCode ?? ''))
}

/**
 * @description 本轮应重载的约束（确定性排序，见 compareConstraints）。筛选口径：
 * 未过期 → turn 只在**明确同轮**（caller 传 currentTurnCode 且行带 turnCode?——§7 没这字段，
 * turn 作用域由**调用方只在本轮内存里保留**来表达，持久筛选一律不放行 turn，防止"上轮的 turn 约束"复活）；
 * session 匹配 conversationCode；channel 本刀如实不接管（见模块头）。
 * @param {Object[]} list 已入册的约束行
 * @param {Object} ctx {now, conversationCode}
 * @returns {{active: Object[], deferred: {constraintCode:String, reason:String}[]}} 结果
 */
export function selectActiveConstraints(list, ctx = {}) {
    const nowMs = toMs(ctx.now) ?? Date.now()
    const active = []
    const deferred = []
    for (const c of Array.isArray(list) ? list : []) {
        if (!c || !c.constraintCode) continue
        const exp = toMs(c.expiresAt)
        if (exp !== null && exp <= nowMs) {
            deferred.push({constraintCode: c.constraintCode, reason: 'expired'})
            continue
        }
        if (c.scope === 'channel') {
            // §7 行结构无 channel 字段，无法核验"同频道"——放行=假装能判，比不判更糟
            deferred.push({constraintCode: c.constraintCode, reason: 'scope-channel-not-hosted'})
            continue
        }
        if (c.scope === 'turn') {
            // turn 的存活期=本轮内存；出现在持久列表里本身就说明它不该再被装配
            deferred.push({constraintCode: c.constraintCode, reason: 'turn-scope-not-persistable'})
            continue
        }
        if (ctx.conversationCode && c.conversationCode !== ctx.conversationCode) {
            deferred.push({constraintCode: c.constraintCode, reason: 'other-conversation'})
            continue
        }
        active.push(c)
    }
    active.sort(compareConstraints)
    return {active, deferred}
}

/**
 * @description 渲染为装配槽文本：**逐字保留、整条进出**。
 * @param {Object[]} active selectActiveConstraints 的 active
 * @param {Object} [opts] {slotMaxChars, header}
 * @returns {{text:String, rendered:String[], deferred:{constraintCode:String,reason:String}[], violations:String[]}} 结果
 */
export function renderConstraints(active = [], opts = {}) {
    const {slotMaxChars = 1200, header = '## 生效中的约束（逐字保留，压缩不得改写）'} = opts
    const rendered = []
    const deferred = []
    const violations = []
    let text = header
    // 防御性再排序：即便调用方绕过 select 直接喂，rank 低的也先被挤
    for (const c of [...active].sort(compareConstraints)) {
        if (!c || !c.constraintCode) continue
        const line = `\n- [${c.kind}|${c.scope}] ${c.text}（授权 ${c.grantedBy?.userCode || '?'} @ ${(toMs(c.grantedBy?.at) ?? 0) || '未知'}${c.expiresAt ? `，至 ${new Date(c.expiresAt).toISOString()}` : ''}）`
        if (text.length + line.length > slotMaxChars) {
            // 整条出槽 + 如实报告；permission 类出槽是治理事故，单独记 violations
            deferred.push({constraintCode: c.constraintCode, reason: 'slot-budget'})
            if (c.kind === 'permission') violations.push(`permission-deferred:${c.constraintCode}`)
            continue
        }
        text += line
        rendered.push(c.constraintCode)
    }
    if (deferred.length) {
        text += `\n- （另有 ${deferred.length} 条约束因槽预算未注入，见 stats）`
    }
    return {text: rendered.length || deferred.length ? text : '', rendered, deferred, violations}
}

export default {CONSTRAINT_SCOPES, CONSTRAINT_KINDS, normalizeConstraint, compareConstraints, selectActiveConstraints, renderConstraints}
