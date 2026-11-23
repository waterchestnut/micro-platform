/**
 * @fileOverview 远程技能治理判据（纯函数，零依赖）——PR-E0.1 的 ①②④⑤ 项
 * @module services/core/skill/skillGovernance
 * @description
 * 现状（2026-11-13 实测）：`services/core/grpcSkill.js` 的 add/update/delete/enable/disable **一个权限判断都没有**，
 * `curUserInfo` 只被用来盖 `operator`；`validateSkillMD` 只查结构不查内容；`grpcHost` 随便填；
 * 技能正文会原样进 fixed 槽（`llmChat.js:346-350`）。这就是 §2.22 的"注册一次、长期生效、影响全体用户"。
 *
 * 三条判据纪律，都是这套东西以前缺的：
 * 1. **缺省即拒**。`reviewStatus` 缺失、值不合法、类型不对 ⇒ 一律按 `pending` 处理，
 *    绝不因为"老数据没这个字段"就放行——那等于"没登记 = 已批准"，把治理实现成绕过。
 *    （同一条先例见 `MemoryStatusEnum` 文件头：独立字段承载生命周期，"避免待审记录被软删过滤掉"。）
 * 2. **身份不明是 401，权限不够是 403**，两种"不行"必须分得开：
 *    否则运维看到的是满屏 403，分不清"网关没传身份"与"这个人确实不该管技能"。
 *    本仓已成文的同类判据见 `contactScope.js:97-100` 与 `message.js:82-84`。
 * 3. **rug pull 要能自动降级**：批准过的技能正文一旦与批准时算的哈希不一致，
 *    装配当场剔除 + 告警 + 审核态回 `pending`。理由写在计划 D36：
 *    审核针对的是**那一刻的内容**，把审核做成一次性开关，等于批准了"以后随便改"。
 */

/** 审核态值域（独立字段，不挤 `status`：后者有 -1 软删语义且 BaseDac 默认过滤） */
export const SKILL_REVIEW = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    /**
     * 批准后作废。必须有独立值：回退成 `pending` 会让审计读成"从没审过"，
     * 而事实是"审过、批了、后来撤了"——这是一次撤销，不是一次遗漏（同 H1 的缺键与 0）。
     */
    REVOKED: 'revoked',
}

export const SKILL_ACTIONS = {
    ADD: 'add',
    UPDATE: 'update',
    DELETE: 'delete',
    ENABLE: 'enable',
    DISABLE: 'disable',
    REVIEW: 'review',
    /**
     * 目录对账（feature-map 刀3，W8）：manifest 是全量语义，**含"该删"的表达权**——
     * 归属人无权单方删掉整批目录条目（投毒者最想要的正是这个批量面），不进 OWNER_ALLOWED。
     */
    RECONCILE: 'reconcile',
}

/** 哪些动作允许"技能归属人"自己做（不需要管理员） */
const OWNER_ALLOWED = new Set([SKILL_ACTIONS.UPDATE, SKILL_ACTIONS.DELETE, SKILL_ACTIONS.ENABLE, SKILL_ACTIONS.DISABLE])

/**
 * @description 归一审核态：**缺字段/非法值都算 pending**
 * @param {Object} v 存储值
 * @returns {String} SKILL_REVIEW 之一
 */
export function normalizeReviewStatus(v) {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
    return Object.values(SKILL_REVIEW).includes(s) ? s : SKILL_REVIEW.PENDING
}

/**
 * @description 这条技能记录能不能进装配（进 fixed 槽与工具清单）
 * @param {Object} skill 技能记录
 * @returns {Boolean} 结果
 *
 * 只看 `status: 0` 是不够的：那是"没被禁用/删除"，不是"内容被审过"。
 * 两个条件都要满足，且审核态走 normalize（缺失即拒）。
 */
export function skillEligibleForAssembly(skill) {
    if (!skill || typeof skill !== 'object') {
        return false
    }
    return skill.status === 0 && normalizeReviewStatus(skill.reviewStatus) === SKILL_REVIEW.APPROVED
}

/**
 * @description 内容哈希核对（防 rug pull）。装配时调用，判据与降级动作都在这里，不散在 provider 里。
 * @param {Object} params 参数
 * @param {Object} params.skill 技能记录（带 skillMDHash）
 * @param {String} params.currentHash 现在这份 skillMD 的哈希
 * @returns {{include: Boolean, degrade: Boolean, reason: String}} 结果
 *
 * `degrade: true` 表示调用方应当把审核态打回 pending 并告警——
 * 只在"批准过但内容变了"时降级；从来没批准过的不需要再降一次。
 */
export function checkContentHash({skill, currentHash = ''} = {}) {
    const stored = skill && typeof skill.skillMDHash === 'string' ? skill.skillMDHash : ''
    if (!stored) {
        /** 没存哈希：老数据或写入路径漏了。不剔除（剔除是内容问题），但标记为需要重新批准 */
        return {include: true, degrade: true, reason: 'hash-missing'}
    }
    if (!currentHash || stored !== currentHash) {
        return {include: false, degrade: true, reason: 'hash-mismatch'}
    }
    return {include: true, degrade: false, reason: 'ok'}
}

/**
 * @description grpcHost 准入（计划 ④：白名单准入，禁止通配）
 * @param {String} host 申报的主机
 * @param {Object} policy 策略
 * @param {String[]} [policy.allowedHosts] 精确主机清单（含端口），空数组＝清单未配置
 * @returns {{allow: Boolean, reason: String}} 结果
 *
 * 为什么"清单为空"要拒而不是放行：把"没配清单"解释成"不限制"，
 * 就是本次要修的那个洞的成因（`egressPolicy` 未设 ⇒ allow-all 是同一条教训，见 §2C.3）。
 * 通配符（`*`、前缀 `.`）也一律拒：白名单的意义在**精确**，允许通配等于把清单写成"看情况"。
 */
export function hostAllowed(host, {allowedHosts = []} = {}) {
    const h = typeof host === 'string' ? host.trim() : ''
    if (!h) {
        return {allow: false, reason: 'host-empty'}
    }
    if (/[*?]|^\./.test(h) || /\$\{/.test(h)) {
        return {allow: false, reason: 'host-wildcard'}
    }
    const list = (Array.isArray(allowedHosts) ? allowedHosts : [])
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim().toLowerCase())
    if (!list.length) {
        return {allow: false, reason: 'host-list-unconfigured'}
    }
    return list.includes(h.toLowerCase())
        ? {allow: true, reason: 'ok'}
        : {allow: false, reason: 'host-not-allowlisted'}
}

/**
 * @description 谁能做这个动作（计划 ①：管理员，或归属匹配）
 * @param {Object} params 参数
 * @param {String} params.action SKILL_ACTIONS 之一
 * @param {Object} [params.actor] `request.userInfo`（只用 userCode / realName）
 * @param {Object} [params.skill] 目标技能记录（add 时为空）
 * @param {Object} [params.policy] 策略
 * @param {String[]} [params.policy.adminUserCodes] 管理员 userCode 清单
 * @param {Boolean} [params.policy.privGranted] ucenter `hasPriv` 的结果（调用方负责取，取不到传 false）
 * @param {Boolean} [params.policy.enforce] 关掉时只观察不拦（应急开关，默认 true）
 * @returns {{allow: Boolean, statusCode: Number, reason: String}} 结果
 *
 * 判据顺序是刻意的：**先确认身份，再谈权限**。
 * 没有 userCode 的请求给 401（网关没传身份是故障，不是越权），
 * 有身份但既不是管理员也不是归属人给 403。
 */
export function decideSkillWrite({action = '', actor = null, skill = null, policy = {}} = {}) {
    const enforce = policy.enforce !== false
    const userCode = typeof actor?.userCode === 'string' ? actor.userCode.trim() : ''
    if (!userCode) {
        /**
         * 应急开关**不旁路这一条**。`enforce=false` 的含义是"权限判断先别拦"，
         * 而"连身份都没有"不是权限松紧问题：那种请求要么是网关没传 `user-info`，要么是从内网直连进来的，
         * 两者都不该往技能表里写东西。把它一起旁路，等于给应急开关装了个"绕过所有校验"的把手。
         */
        return {allow: false, statusCode: 401, reason: 'no-identity'}
    }
    if (!Object.values(SKILL_ACTIONS).includes(action)) {
        return {allow: false, statusCode: 403, reason: 'unknown-action'}
    }
    const admins = (Array.isArray(policy.adminUserCodes) ? policy.adminUserCodes : [])
        .map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
    const isAdmin = admins.includes(userCode) || policy.privGranted === true
    const isOwner = Boolean(skill?.operator?.userCode) && skill.operator.userCode === userCode
    const ok = isAdmin || (OWNER_ALLOWED.has(action) && isOwner)
    if (ok) {
        return {allow: true, statusCode: 200, reason: isAdmin ? 'admin' : 'owner'}
    }
    /**
     * 拒绝措辞（刀3等价改写）：**不在 owner 可自助清单里的动作本就是管理动作**，
     * 按集合取反而非逐个枚举——上一版枚举 ADD/REVIEW，reconcile 进来就会漏报成
     * "not-owner-not-admin"（明明是 admin-only 动作却按归属失败叙述）。取反式对未来新增
     * admin-only 动作自动正确（枚举式忘改=措辞漂移，这次是预防）。
     */
    const denyReason = OWNER_ALLOWED.has(action) ? 'not-owner-not-admin' : 'admin-required'
    /**
     * 应急开关只旁路"权限"这一层（身份缺失已经在上面拦掉了）。
     * 旁路时 reason 前面加 `enforce-off:` —— 上一版这里直接返回真实拒绝结论，
     * 于是这个开关**按下去没有任何效果**：一个不生效的应急开关比没有更糟，
     * 因为运维会以为自己有退路，真出事时才想起它从来没通过电。
     */
    if (!enforce) {
        return {allow: true, statusCode: 403, reason: `enforce-off:${denyReason}`}
    }
    return {allow: false, statusCode: 403, reason: denyReason}
}

/**
 * @description 审核状态迁移（谁能批准/驳回，以及能不能自己批自己）
 * @param {Object} params 参数
 * @param {String} params.from 当前审核态
 * @param {String} params.to 目标审核态
 * @param {Object} [params.actor] 操作者
 * @param {Object} [params.skill] 技能记录
 * @param {Object} [params.policy] 策略
 * @returns {{allow: Boolean, statusCode: Number, reason: String}} 结果
 *
 * 单独一条而不是复用 `decideSkillWrite`：**作者自己批准自己的技能**在语义上是另一回事，
 * 归属校验会把它放成 "owner"，而那恰恰是投毒者最想要的能力（自己注册、自己批准、进全体用户上下文）。
 */
export function decideReviewTransition({to = '', actor = null, skill = null, policy = {}} = {}) {
    const userCode = typeof actor?.userCode === 'string' ? actor.userCode.trim() : ''
    if (!userCode) {
        return {allow: false, statusCode: 401, reason: 'no-identity'}
    }
    /** 允许的目标态：批准、驳回、撤销。**不许把状态改回 pending**——那是"重走审核"的动作，不是审核结论 */
    const REVIEW_TARGETS = [SKILL_REVIEW.APPROVED, SKILL_REVIEW.REJECTED, SKILL_REVIEW.REVOKED]
    if (!REVIEW_TARGETS.includes(to)) {
        return {allow: false, statusCode: 403, reason: 'invalid-target'}
    }
    const admins = (Array.isArray(policy.adminUserCodes) ? policy.adminUserCodes : [])
        .map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
    if (!(admins.includes(userCode) || policy.privGranted === true)) {
        return {allow: false, statusCode: 403, reason: 'admin-only'}
    }
    return {allow: true, statusCode: 200, reason: 'approved-by-admin'}
}

/**
 * @description 写库该带的治理字段（把"新内容必须重新待审"写成代码，不靠作者自觉）
 * @param {Object} params 参数
 * @param {Object} [params.skill] 现有记录（update 时）
 * @param {String} [params.newSkillMD] 新正文
 * @param {String} [params.newHash] 新正文哈希
 * @param {Object} [params.actor] 操作者
 * @returns {{reviewStatus: String, skillMDHash: String, reviewReset: Boolean}} 结果
 *
 * 规则：**正文变了，审核态就回 pending**（除批准者本人写的批准动作，那走 decideReviewTransition）。
 * 这是 D36 的另一半：哈希核对是"事后发现"，这里是"事前不继承批准"。
 */
export function governanceFieldsForWrite({skill = null, newSkillMD = '', newHash = '', actor = null} = {}) {
    const mdChanged = Boolean(newSkillMD) && newSkillMD !== skill?.skillMD
    return {
        reviewStatus: mdChanged || !skill ? SKILL_REVIEW.PENDING : normalizeReviewStatus(skill?.reviewStatus),
        skillMDHash: newHash || skill?.skillMDHash || '',
        reviewReset: mdChanged || !skill,
        reviewedBy: mdChanged || !skill ? null : (skill?.reviewedBy || null),
        reviewedAt: mdChanged || !skill ? null : (skill?.reviewedAt || null),
        actorUserCode: typeof actor?.userCode === 'string' ? actor.userCode : '',
    }
}
