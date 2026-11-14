/**
 * @fileOverview PR-15：沙箱出网策略构造
 * @module services/sandbox/egress
 * @description 契约来自上游 `specs/egress-api.yaml` + `specs/sandbox-lifecycle.yml` +
 * `docs/guides/network-isolation.md`（release-1.2.0-rc.1 实测克隆核对），要点：
 *   1. 规则形状只有 `{action, target}`，**target 可以是 FQDN / 通配域 / IP / CIDR，没有端口字段**；
 *   2. `dns+nft` 是**包层 default-deny**，放行集群内 Service 必须 **DNS 名与 Service CIDR 两层都给**，
 *      只给 FQDN 会在解析后被 nftables 丢掉（上游文档 114-135 行专门写了这个坑）；
 *   3. 侧车**自动放行 nameserver IP**，但不自动放行应用流量的 ClusterIP；
 *   4. PATCH 是 merge、**同 target 先到先赢**；lifecycle 的 PUT `/networkpolicy` 是**整体替换**；
 *   5. **池模式（`extensions.poolRef`）不接受 create 时的 networkPolicy**，
 *      server 无法给单个 allocation 注侧车，会直接拒绝 —— 且侧车**只在 create 带策略时注入**
 *      （§5.24），"建完再 PUT"救不回来：没侧车就没有 PUT 的后端。带策略请走非池直传。
 *   6. **vault 与策略互为守门**（§5.29 实测）：binding host 未被 allow 时建档 400；
 *      建档后再 PUT 丢掉该 host 的策略也 400。次序必须"先全量策略（含 binding hosts）→ 再建档"，
 *      收紧策略要先删/改 vault。见 `assertPolicyCoversBindings`。
 * @author xianyang
 */

/** 集群内 Service 名的特征：`.svc.cluster.local`、`.svc`，或不含点的短名（走 pod resolver 的 search 域） */
const SVC_SUFFIX = '.svc.cluster.local'

/**
 * @description 从 URL 或裸 host 里取 host 段
 * @param {String} u 形如 `http://llm-api-http.xxzx:80` 或 `llm-api-http.xxzx`
 * @returns {String} 小写 host（去端口）；取不到时空串
 */
export function hostOfUrl(u = '') {
    const s = String(u || '').trim().toLowerCase()
    if (!s) {
        return ''
    }
    const noProto = s.includes('://') ? s.split('://')[1] : s
    const host = (noProto.split('/')[0] || '').split('?')[0]
    return host.split(':')[0]
}

/**
 * @description 取 `name.namespace` 形式里的命名空间；不是这个形状时返回空串
 * @param {String} host 已去协议去端口的 host
 * @returns {String} 命名空间或空串
 *
 * 为什么要单独一个函数而不是在 `looksInternal` 里直接判"两段就算内部"：
 * **`llm-api-http.xxzx` 和 `example.com` 都是两段**——段数不能区分内外，
 * 能区分的只有"第二段是不是我们已知的命名空间"。把它写成独立函数，
 * 是为了让调用方必须显式交出名空间来源（配置或 `skillHost.baseUrl`），而不是让判据偷偷猜。
 */
export function namespaceOfHost(host = '') {
    const h = String(host || '').trim().toLowerCase()
    if (!h || h.includes('/')) {
        return ''
    }
    const labels = h.split('.')
    if (labels.length !== 2) {
        return ''
    }
    if (!labels[0] || !labels[1]) {
        return ''
    }
    return labels[1]
}

/**
 * @description 判断是否指向集群内部目标（这类目标必须额外放行 Service CIDR）
 * @author xianyang
 * @param {String} target 规则 target
 * @param {String[]} [extraSuffixes] 额外认定的内部后缀
 * @param {String[]} [internalNamespaces] 已知的集群命名空间（第二段命中即算内部）
 * @returns {Boolean} false 表示是纯外部 FQDN/IP/CIDR
 *
 * 修的是 E0.6 ④：上一版认不出 `name.namespace` 与 `.svc` 两种形式，
 * 而技能回连宿主用的正是 `llm-api-http.xxzx`（`skillHost.baseUrl` 的默认值）——
 * 于是"内部目标必须给 serviceCidrs"这道保护**一次也没为它触发过**，
 * 收紧后的症状会是"DNS 放行、解析后被 nftables 丢弃"的偶发失败且日志无错（§2B.4 原话）。
 * 讽刺的是旧注释里举的例子恰好就是这个 host，说明当时是照着例子写的判据，却没验证例子本身。
 */
export function looksInternal(target = '', extraSuffixes = [], internalNamespaces = []) {
    const t = String(target).trim().toLowerCase()
    if (!t || t.includes('/')) {
        // CIDR（含 /）是网络层规则，本身就在解决 second layer
        return false
    }
    if (t.endsWith(SVC_SUFFIX) || t.endsWith('.svc')) {
        return true
    }
    for (const s of extraSuffixes || []) {
        if (s && t.endsWith(String(s).toLowerCase())) {
            return true
        }
    }
    /** 不含点：靠 resolver search 列表拼出来的 Service 短名 */
    if (!t.includes('.')) {
        return true
    }
    /** `name.namespace`：只有第二段是已知命名空间才算内部，否则与 `example.com` 无法区分 */
    const ns = namespaceOfHost(t)
    if (ns) {
        const list = (internalNamespaces || []).map((x) => String(x).toLowerCase()).filter(Boolean)
        if (list.includes(ns)) {
            return true
        }
    }
    return false
}

/**
 * @description 由配置构造 egress 策略（PUT 到 lifecycle `/networkpolicy` 的请求体）
 * @author xianyang
 * @param {Object} params 入参
 * @param {String[]} [params.allow] 要放行的 FQDN/通配域/IP/CIDR
 * @param {String[]} [params.serviceCidrs] 集群 Service CIDR（如 10.43.0.0/16），有内部目标时必填
 * @param {String} [params.defaultAction] 'deny'（默认）或 'allow'
 * @param {String[]} [params.internalSuffixes] 额外视为内部的域名后缀
 * @returns {Object} {defaultAction, egress:[{action,target}]}
 */
export function buildEgressPolicy(params = {}) {
    const {allow = [], serviceCidrs = [], defaultAction = 'deny', internalSuffixes = [], internalNamespaces = []} = params
    if (!['deny', 'allow'].includes(defaultAction)) {
        throw new Error(`defaultAction 只能是 deny 或 allow，收到：${defaultAction}`)
    }
    const rules = []
    const seen = new Set()
    const push = (action, target) => {
        const t = String(target || '').trim()
        if (!t) {
            return
        }
        /** PATCH 语义里同 target 先到先赢；这里显式去重，避免把顺序不确定性带进 PUT（整体替换） */
        const key = `${action}:${t.toLowerCase()}`
        if (seen.has(key)) {
            return
        }
        seen.add(key)
        rules.push({action, target: t})
    }

    for (const t of allow || []) {
        push('allow', t)
    }
    for (const cidr of serviceCidrs || []) {
        if (!cidr.includes('/')) {
            throw new Error(`serviceCidrs 必须是 CIDR（带 /），收到：${cidr}`)
        }
        push('allow', cidr)
    }

    const internal = (allow || []).filter(t => looksInternal(t, internalSuffixes, internalNamespaces))
    if (defaultAction === 'deny' && internal.length && !(serviceCidrs || []).length) {
        throw new Error(
            `放行了集群内目标（${internal.join(', ')}）但没给 serviceCidrs：` +
            'dns+nft 下 DNS 名与 Service CIDR 两层都要放行，只给域名会在解析后被 nftables 丢掉。' +
            '请补 sandboxConfig.egressPolicy.serviceCidrs（如 ["10.43.0.0/16"]）。' +
            `（判内部的两类依据：internalSuffixes=${JSON.stringify(internalSuffixes)}、internalNamespaces=${JSON.stringify(internalNamespaces)}）`,
        )
    }

    /** 默认放行 DNS：侧车把 53 端口流量重定向进自己的 DNS 代理，显式写出来便于审计，不依赖实现细节 */
    return {defaultAction, egress: rules}
}

/**
 * @description 校验一份来自配置的策略对象是否可用（不做隐式补全，缺字段就报可行动的错误）
 * @author xianyang
 * @param {Object} policy {defaultAction, egress:[{action,target}]}
 * @returns {Object} 归一化后的策略
 */
export function normalizeEgressPolicy(policy = {}) {
    const defaultAction = policy.defaultAction || 'deny'
    const egress = (policy.egress || []).map((r, i) => {
        const action = String(r?.action || '').toLowerCase()
        const target = String(r?.target || '').trim()
        if (!['allow', 'deny'].includes(action)) {
            throw new Error(`egress[${i}].action 必须是 allow/deny，收到：${r?.action}`)
        }
        if (!target) {
            throw new Error(`egress[${i}].target 不能为空`)
        }
        return {action, target}
    })
    if (defaultAction === 'deny' && !egress.some(r => r.action === 'allow')) {
        throw new Error('defaultAction=deny 且没有任何 allow 规则：这会把沙箱变成孤岛（连回连宿主都连不上）')
    }
    return {defaultAction, egress}
}

/**
 * @description 已知的集群命名空间清单：配置优先，其次从 `skillHost.baseUrl` 推出来
 * @author xianyang
 * @param {Object} [cfgNamespaces] 配置里显式给的命名空间
 * @returns {String[]} 去重后的小写清单
 *
 * 为什么要自动从 `skillHost.baseUrl` 推：技能回连宿主的目标**就是这个值**，
 * 让它必须靠运维再手抄一遍命名空间，等于把"保护触发不了"这个原 bug 换个位置保留下来。
 * 推不出来时（比如 baseUrl 用了全限定 `.svc.cluster.local`）也不猜：那种形式 `looksInternal` 本来就认得。
 */
export function knownInternalNamespaces(cfgNamespaces = []) {
    const out = []
    for (const n of (Array.isArray(cfgNamespaces) ? cfgNamespaces : [])) {
        const s = String(n || '').trim().toLowerCase()
        if (s) {
            out.push(s)
        }
    }
    try {
        const base = llm?.config?.skillHost?.baseUrl
        const ns = namespaceOfHost(hostOfUrl(base))
        if (ns && !out.includes(ns)) {
            out.push(ns)
        }
    } catch (e) {
        /** 全局配置在单测里可能不存在：推不出来就少一个依据，绝不因此抛错 */
    }
    return out
}

/**
 * @description 读取全局配置里的出网策略；未配置即返回 null（表示不做收紧，保持现状）
 * @author xianyang
 * @returns {Object|null} 归一化后的策略，或 null
 *
 * ⚠️ "未配置就 allow-all"仍然是现状，因为 dev 实测 `sandbox_enabled=true` 且
 * `sandbox_skillExecMode=sandbox`——直接把 null 变成拒绝会让正在用的技能执行当场停摆。
 * E0.6 的 ③（未配置即拒绝启用 sandbox）由 `egressPosture` 提供开关与告警，不在这里偷偷改默认。
 */
export function egressPolicyFromConfig() {
    const cfg = (typeof llm !== 'undefined' ? llm.config?.sandboxConfig?.egressPolicy : null) || null
    if (!cfg) {
        return null
    }
    const namespaces = knownInternalNamespaces(cfg.internalNamespaces)
    if (Array.isArray(cfg.allow) || Array.isArray(cfg.serviceCidrs)) {
        /** 简写形式：只给 allow/serviceCidrs，由 buildEgressPolicy 负责双层放行校验 */
        return buildEgressPolicy({...cfg, internalNamespaces: namespaces})
    }
    const policy = normalizeEgressPolicy(cfg)
    /**
     * 完整形式以前**什么也不校验**，所以"内部目标没配 CIDR"这个原 bug 在这条路径上连报错都不会有。
     * 这里补上检查，但只 warn 不抛：完整形式是给懂行的人手写的，突然抛错会让一次配置改动变成一次建箱失败；
     * 而"从来没触发过"的病因已经被这次告警覆盖，剩下的是运维要不要立刻处理。
     */
    const allows = (policy.egress || []).filter(r => r.action === 'allow').map(r => r.target)
    const internal = allows.filter(t => looksInternal(t, cfg.internalSuffixes || [], namespaces))
    const hasCidr = allows.some(t => t.includes('/'))
    if (policy.defaultAction === 'deny' && internal.length && !hasCidr) {
        llm.logger.warn(`egress 完整形式里放行了集群内目标（${internal.join(', ')}）却没有 CIDR 规则：`
            + 'dns+nft 下可能解析后被丢弃。请补一条如 "10.43.0.0/16" 的 allow 规则')
    }
    return policy
}

/**
 * @description vault 建档/改策略前的守门：策略必须覆盖全部 binding hosts（§5.29 实测契约）
 *
 * 上游两侧都会拒绝：建档时 binding host 不在 allow 内 → 400；
 * 建档后 PUT 一份丢掉该 host 的新策略 → 400（`credential vault policy validation`）。
 * 与其撞 400，不如在本地先算清楚缺哪些。通配域 `*.example.com` 视为覆盖子域，不覆盖裸域。
 * @author xianyang
 * @param {Object} policy {defaultAction, egress:[{action,target}]}
 * @param {Object[]} bindings vault bindings（[{name, match:{hosts}}]）
 */
export function assertPolicyCoversBindings(policy, bindings = []) {
    const allows = (policy?.egress || []).filter(r => r.action === 'allow').map(r => String(r.target).toLowerCase())
    const exact = new Set(allows)
    const wildcards = allows.filter(t => t.startsWith('*.')).map(t => t.slice(1))
    const missing = []
    for (const b of bindings || []) {
        for (const h of b?.match?.hosts || []) {
            const host = String(h).toLowerCase()
            if (exact.has(host) || wildcards.some(w => host.endsWith(w))) {
                continue
            }
            missing.push(`${b?.name || '?'} → ${h}`)
        }
    }
    if (missing.length) {
        throw new Error(`egress 策略未覆盖 credential binding：${missing.join('; ')}。` +
            '上游守门会直接 400（建档与策略变更双向校验）。先补齐 allow，再建档；收紧策略要先删/改 vault。')
    }
}

export default {buildEgressPolicy, normalizeEgressPolicy, looksInternal, hostOfUrl, namespaceOfHost, knownInternalNamespaces, egressPolicyFromConfig, assertPolicyCoversBindings}
