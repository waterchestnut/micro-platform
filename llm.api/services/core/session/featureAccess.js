/**
 * @fileOverview 功能目录访问判据（platform-feature-map Phase 1 首刀，纯函数零依赖）
 * @module services/core/session/featureAccess
 * @description
 * 设计稿定稿的判据三件合住这一个文件（有名有姓的那几个名字，开工就长在这）：
 * - `decideFeatureAccess`：**两层权限合取**（§9 属主修正模型）——
 *   `(browseGate⇒priv OK) ∧ (featurePrivs 全 OK)`；priv 判定结果由调用方取（hasPriv fail-closed
 *   的 RPC 面在 service），本件只做合取——判定与 IO 分离（runGate/creditMeter 同族纪律）。
 *   browseGate 缺失/非法 ⇒ 保守 true（缺省即严，normalizeReviewStatus 同款性格）。
 * - `decideEffectClass`：W6 归一单源——字段存在取字段；缺失⇒`legacyPassthrough`（存量直通，
 *   read 允许 guide 照常）；**schema default:'guide' 只约束新写入，装配判据不吃 schema 默认**。
 * - `decideFeatureToolScope`：W10 作用域红线——编排 child 只见 guide/read（child 不注册
 *   ask_user，写面提案在 child 里发不出也等不了=死锁；agentChat.js:13 取证过）。
 * `normalizeFeatureEntry`：把库行归一成判据可直接吃的形状（含 paramsSchema identityParams
 * 收敛单源的读取位——W1 定稿：方法面 identityParams 优先，paramsSchema.x-identity 兼容读，
 * 两处都空=未声明（Phase 1 在册方法逐条补标，V10 清单））。
 */

const VALID_EFFECTS = new Set(['guide', 'read', 'write'])

/**
 * @description 两层合取的访问判定（防线 1 装配过滤与防线 2 执行复验**共用本件**，两处判据必分叉之防）
 * @param {Object} p
 * @param {Object} p.entry 归一后的目录条目（normalizeFeatureEntry 产物或同形）
 * @param {Object} [p.granted] 已判定的 priv 集合 {privCode: Boolean}（调用方批量 hasPriv 后喂，V8 缓存粒度）
 * @returns {{allow: Boolean, reason: String}} reason: ok | browse-denied | feature-denied:<priv>
 */
export function decideFeatureAccess({ entry = {}, granted = {} } = {}) {
    // 缺省即严：只有**显式 false** 才免入口门；undefined/null/脏值/字符串一律按 true
    // （库里显式 null 与缺字段同属"没登记过门控事实"，不能读成"不需要门"）
    const browseGate = entry.browseGate === false ? false : true
    if (browseGate) {
        const browsePriv = `${entry.clientCode || ''}-browse`
        if (granted[browsePriv] !== true) return { allow: false, reason: 'browse-denied' }
    }
    const feats = Array.isArray(entry.featurePrivs) ? entry.featurePrivs : []
    for (const p of feats) {
        const priv = typeof p === 'string' ? p.trim() : ''
        if (priv && granted[priv] !== true) return { allow: false, reason: `feature-denied:${priv}` }
    }
    return { allow: true, reason: 'ok' }
}

/**
 * @description 效果级归一（W6）：缺失⇒legacyPassthrough；非法值按 guide 保守但不冒充直通
 * @param {Object} skill 库行/条目
 * @returns {{effect: String, passthrough: Boolean}} passthrough=true 仅指"存量无字段行"
 */
export function decideEffectClass(skill = {}) {
    const v = typeof skill.effectClass === 'string' ? skill.effectClass.trim() : ''
    if (!v) return { effect: '', passthrough: true }          // 存量直通：读面允许、引导照常
    if (!VALID_EFFECTS.has(v)) return { effect: 'guide', passthrough: false } // 脏词按最保守
    return { effect: v, passthrough: false }
}

/**
 * @description 工具作用域（W10）：编排 child 里 write 工具不注入（提案发不出=死锁）
 * @param {Object} p
 * @param {Boolean} [p.isOrchestratedChild] 是否编排 child 执行轮
 * @param {String} [p.effect] decideEffectClass 的 effect（passthrough 时传 ''）
 * @returns {{include: Boolean, reason: String}}
 */
export function decideFeatureToolScope({ isOrchestratedChild = false, effect = '' } = {}) {
    if (isOrchestratedChild && effect === 'write') {
        return { include: false, reason: 'child-write-excluded(W10)' }
    }
    return { include: true, reason: 'ok' }
}

/**
 * @description 库行→判据条目归一（装配读取面；identityParams 声明位收敛，W1）
 * @param {Object} row grpcSkill 库行
 * @returns {Object} {clientCode, browseGate, featurePrivs, effect, effectInfo, invoke, identityParams}
 */
export function normalizeFeatureEntry(row = {}) {
    const effectInfo = decideEffectClass(row)
    // W1 单源读取：方法面 identityParams（invokeSpec 里，Phase 1 定稿位）优先；
    // paramsSchema.properties.*.x-identity 兼容读（早期设计残留形状）；两处都声明⇒取方法面并报警字段
    const invoke = row.invokeSpec && typeof row.invokeSpec === 'object' ? row.invokeSpec : {}
    let identityParams = Array.isArray(invoke.identityParams)
        ? invoke.identityParams.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
        : []
    const schemaIdentity = Object.entries((invoke.paramsSchema && invoke.paramsSchema.properties) || {})
        .filter(([, v]) => v && v['x-identity'] === true).map(([k]) => k)
    const declaredBoth = identityParams.length > 0 && schemaIdentity.length > 0
    if (!identityParams.length) identityParams = schemaIdentity
    return {
        clientCode: String(row.clientCode || ''),
        browseGate: row.browseGate,
        featurePrivs: Array.isArray(row.featurePrivs) ? row.featurePrivs : [],
        effect: effectInfo.effect,
        effectInfo,
        invoke,
        identityParams,
        // 两处并存=单源纪律违例（不静默选边，报警字段供装配面记 runStats）
        identityDeclaredBoth: declaredBoth,
    }
}

export default { decideFeatureAccess, decideEffectClass, decideFeatureToolScope, normalizeFeatureEntry }
