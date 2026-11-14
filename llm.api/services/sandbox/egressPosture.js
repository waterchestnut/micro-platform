/**
 * @fileOverview 沙箱出网态势判定（纯函数，零依赖）——PR-E0.6 ③
 * @module services/sandbox/egressPosture
 * @description
 * 要解决的是 §2C.3 那条高危事实：我们从不在建箱时带 `networkPolicy`，
 * 上游 spec 明说"省略即 allow-all"，而 dev 池 Pod 里连 egress 侧车都没有
 * ⇒ **模型生成的代码可以访问集群内任意服务与任意外网**。
 *
 * 但"未配策略就拒绝启用 sandbox"这条判据**不能直接默认生效**，理由是实测的：
 * dev 现在 `sandbox_enabled=true` 且 `sandbox_skillExecMode=sandbox`，技能真的在沙箱里跑；
 * 把 null 直接变成拒绝，等于在一次治理提交里让正在使用的能力当场停摆——
 * 与 §25 记过的"顺手删掉 relay key ⇒ 发版即 401"是同一类错误，只是换了资源。
 *
 * 所以这里把态势分成四档，**默认落在"可见但不阻断"那一档**，并把切换条件写清楚：
 *   disabled            沙箱没开，无所谓
 *   tightened           配了策略，正常收紧
 *   allow-all-visible   没配策略且未强制 ⇒ 照常建箱，但每次启动/建箱都要说一次（现状）
 *   refused             没配策略且 `sandbox_egressEnforcePolicy=true` ⇒ 拒绝建箱
 *
 * 切换顺序写在日志文案里，不在注释里：运维需要知道"先配 allow+serviceCidrs，再打开强制"。
 */

export const EGRESS_MODE = {
    DISABLED: 'disabled',
    TIGHTENED: 'tightened',
    ALLOW_ALL_VISIBLE: 'allow-all-visible',
    REFUSED: 'refused',
}

/**
 * @description 判定当前出网态势
 * @param {Object} params 参数
 * @param {Boolean} [params.sandboxEnabled] `sandbox_enabled`
 * @param {Object|null} [params.policy] `egressPolicyFromConfig()` 的结果（null 即未配置）
 * @param {Boolean} [params.enforcePolicy] 是否强制（`sandbox_egressEnforcePolicy`）
 * @returns {{mode: String, reason: String, blocks: Boolean}} 结果
 *
 * `blocks` 是给调用方看的：**只有 refused 才阻断**，其余都放行。
 * 判定与阻断分离，是为了让"要不要拦"这件事只由一个配置开关决定，
 * 而不是散在 if 里——散开之后就会出现"某些路径拦了、某些没拦"的分家。
 */
export function decideEgressPosture({sandboxEnabled = false, policy = null, enforcePolicy = false} = {}) {
    if (!sandboxEnabled) {
        return {mode: EGRESS_MODE.DISABLED, reason: 'sandbox-not-enabled', blocks: false}
    }
    if (policy) {
        return {mode: EGRESS_MODE.TIGHTENED, reason: 'policy-configured', blocks: false}
    }
    if (enforcePolicy) {
        return {mode: EGRESS_MODE.REFUSED, reason: 'policy-missing-enforced', blocks: true}
    }
    return {mode: EGRESS_MODE.ALLOW_ALL_VISIBLE, reason: 'policy-missing-visible-only', blocks: false}
}

/**
 * @description 态势文案：告警与拒绝共用，**不含任何密钥或内部地址清单以外的敏感信息**
 * @param {Object} decision decideEgressPosture 的结果
 * @param {Object} [ctx] 上下文（用于把"该配什么"说清楚）
 * @param {String[]} [ctx.requiredHosts] 已知的必须放行目标（如技能回连 host）
 * @returns {String} 文案
 */
export function formatPostureForLog(decision, {requiredHosts = []} = {}) {
    const need = requiredHosts.length ? `；至少要放行这些集群内目标：${requiredHosts.join(', ')}` : ''
    switch (decision?.mode) {
        case EGRESS_MODE.ALLOW_ALL_VISIBLE:
            return `沙箱出网未收紧（未配 sandbox_egressPolicy ⇒ 上游按 allow-all 处理）：`
                + `模型生成的代码可访问集群内任意服务与任意外网（§2C.3）。`
                + `先配 egressPolicy{allow, serviceCidrs}，确认技能仍可运行后，再打开 sandbox_egressEnforcePolicy=true${need}`
        case EGRESS_MODE.REFUSED:
            return '沙箱已启用但没有出网策略，且 sandbox_egressEnforcePolicy=true ⇒ 拒绝建箱。'
                + `请配置 sandbox_egressPolicy（defaultAction=deny + allow + serviceCidrs）${need}；`
                + '若只是要临时恢复执行，把 enforce 关掉，但那条 allow-all 告警会一直出现'
        case EGRESS_MODE.TIGHTENED:
            return '沙箱出网已收紧（建箱带 networkPolicy）'
        default:
            return '沙箱未启用，跳过出网态势检查'
    }
}

/**
 * @description 建箱前的闸门：只有 refused 才抛
 * @param {Object} params 参数
 * @param {Object} params.decision 态势判定
 * @returns {void}
 */
export function assertSandboxEgressAllowed(decision) {
    if (decision?.blocks) {
        throw new Error(formatPostureForLog(decision))
    }
}
