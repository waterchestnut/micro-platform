/**
 * @fileOverview 在 OpenSandbox 里跑自包含 skill 脚本与模型生成代码
 * @module services/sandbox/runner
 * @description 两件事共用一套底层：把代码送进沙箱、拿回结果、**无论如何都回收沙箱**。
 *
 * 三条刻意的设计：
 * 1. **用完必回收**：`withSandbox` 里 finally 销毁，且销毁失败要告警而不是静默——
 *    沙箱按 timeout 也会过期，但等过期期间它占着池容量，等于慢性拒绝服务；
 * 2. **模型代码只在沙箱里跑**：注入 env 只放行白名单前缀，宿主密钥/relay apiKey 一律不进；
 * 3. **共享沙箱有 TTL 且可关**：`run_code` 复用同一会话的沙箱（省冷启动），
 *    但登记表在进程内，重启即失效——这点必须写在注释里，别让人以为它是持久状态。
 */
import {buildSkillBundle, parseBundleResult, checkSelfContained} from '../../tools/skillBundle.js'
import {issueCapabilityToken} from './capability.js'
import {egressPolicyFromConfig} from './egress.js'
import {assertQuota, recordUsage, setActiveProvider} from './usage.js'
import {sandboxClient} from './openSandbox.js'

const logger = () => (typeof llm !== 'undefined' && llm.logger ? llm.logger : console)
const cfg = () => (typeof llm !== 'undefined' ? (llm.config?.sandboxConfig || {}) : {})

/** 允许注入沙箱的 env 前缀（凭据类一律拒绝） */
const ENV_ALLOW = /^(SKILL_|SANDBOX_|TASK_|APP_)/

export function pickEnv(env = {}) {
    const out = {}
    for (const [k, v] of Object.entries(env || {})) {
        if (!ENV_ALLOW.test(k)) {
            logger().warn(`沙箱 env 丢弃非白名单键 ${k}`)
            continue
        }
        out[k] = String(v)
    }
    return out
}

/**
 * @description 池与出网策略互斥要在建箱之前就拒掉
 *
 * dev 探针（§5.24）实测：池沙箱里 lifecycle GET/PUT /networkpolicy 一律 502
 * BACKEND_CONNECTION_FAILED（连不上 pod:18080）。原因不是配置漏了，而是上游设计：
 * egress 侧车"只在请求带 networkPolicy 时才启动"，而池模式明确不接受 create 里的
 * networkPolicy（server 无法为单个 allocation 注侧车）—— 两头一夹，
 * **池沙箱永远没有侧车**。所以带策略的请求必须走非池模式，而不是建完箱再撞 502。
 * @author xianyang
 * @param {String} poolRef 将要使用的池标识（空表示非池）
 * @param {Object|null} policy 出网策略
 */
export function assertPoolPolicyCompatible(poolRef, policy) {
    if (policy && poolRef) {
        throw new Error(
            `出网策略与池模式互斥（poolRef=${poolRef}）：池沙箱不会被注入 egress 侧车，` +
            'PUT /networkpolicy 必然 502。带策略的请求请改用非池模式——' +
            '配 sandbox_defaultPoolRef="" 关掉池，并提供 sandbox_defaultImage 与 sandbox_defaultResourceLimits。',
        )
    }
}

/**
 * @description 组装 create 请求体（纯函数，离线可测）—— §5.29 实测后的形状
 *
 * 三条实测契约钉在这里：
 * 1. **egress 侧车只在 create 带 `networkPolicy` 时才注入**（§5.24：池沙箱恒无侧车），
 *    所以策略必须**建箱时直传**，"建完再 PUT"打的是没有监听者的路由（502）；
 * 2. `credentialProxy.enabled` 与 `poolRef` **同样互斥**（上游 create schema 原文），
 *    且它要求 `networkPolicy` 在场（"Plain networkPolicy does not enable transparent MITM
 *    unless this option is set"——412 的修复是这个字段，不是 server 配置）；
 * 3. 非池 create 必填 `image`+`entrypoint`+`resourceLimits`（spec：poolRef 缺省时 resourceLimits 必填）。
 * @author xianyang
 * @param {Object} params 组装材料
 * @returns {Object} POST /sandboxes 请求体
 */
export function buildCreateBody(params = {}) {
    const {poolRef = '', egress = null, credentialProxy = false, image, entrypoint, resourceLimits, timeout, metadata} = params
    assertPoolPolicyCompatible(poolRef, egress)
    if (credentialProxy) {
        if (poolRef) {
            throw new Error(`credentialProxy 与池模式互斥（poolRef=${poolRef}，上游 create schema 与 networkPolicy 同档拒绝）。带 vault 的会话请走非池。`)
        }
        if (!egress) {
            throw new Error('credentialProxy.enabled 需要同时提供 networkPolicy（上游 CredentialProxyConfig 原文 "Requires networkPolicy"）。请先配 sandbox_egressPolicy。')
        }
    }
    const body = {
        extensions: {...(poolRef ? {poolRef} : {})},
        ...(timeout ? {timeout} : {}),
        ...(metadata ? {metadata} : {}),
    }
    if (!poolRef) {
        if (!image) {
            throw new Error('非池建箱必须给镜像：传 params.image 或配 sandbox_defaultImage（Harbor 已有 opensandbox/code-interpreter:v1.1.0）')
        }
        if (!resourceLimits) {
            throw new Error('非池建箱必须给 resourceLimits：配 sandbox_defaultResourceLimits，如 {"cpu":"500m","memory":"512Mi"}')
        }
        body.image = {uri: image}
        body.entrypoint = (entrypoint && entrypoint.length) ? entrypoint : ['tail', '-f', '/dev/null']
        body.resourceLimits = resourceLimits
        if (egress) {
            body.networkPolicy = egress
        }
        if (credentialProxy) {
            body.credentialProxy = {enabled: true}
        }
    }
    return body
}

/**
 * @description 回读校验侧车策略；**默认 fail-closed**
 *
 * 为什么是 GET 回读而不是 PUT 下发：侧车只存在于"create 带了 networkPolicy"的沙箱里
 * （§5.24 机制 + §5.28 反证），策略在 create 时已由 server 落进侧车；建后再 PUT 反而会把
 * "池沙箱永远没侧车"这类结构性错误伪装成一次可重试的网络失败。
 * 502 `BACKEND_CONNECTION_FAILED` 是硬证据（§5.24 的假阳性教训：能解析出入口 ≠ 组件存在）。
 * 不想被阻断时显式 `sandbox_egressEnforce=false` 降级为告警。
 * @author xianyang
 * @param {Object} client 沙箱客户端
 * @param {String} sandboxId 沙箱标识
 * @param {Object|null} policy create 时传入的策略（null 即空操作）
 * @returns {Promise<Boolean>} 是否确认到位
 */
export async function verifyEgressPolicy(client, sandboxId, policy) {
    if (!policy) {
        return false
    }
    try {
        const live = await client.getNetworkPolicy(sandboxId)
        const rules = (live?.policy?.egress || live?.egress || [])
        const targets = new Set(rules.map(r => String(r.target || '').toLowerCase()))
        const missing = policy.egress
            .filter(r => r.action === 'allow' && !targets.has(String(r.target).toLowerCase()))
            .map(r => r.target)
        if (missing.length) {
            throw new Error(`回读策略缺少 allow 目标：${missing.join(', ')}`)
        }
        logger().info(`沙箱 ${sandboxId} 出网策略回读一致 default=${policy.defaultAction} rules=${policy.egress.length} mode=${live?.mode || ''}`)
        return true
    } catch (e) {
        if (cfg().egressEnforce === false) {
            logger().warn(`沙箱 ${sandboxId} 出网策略回读失败（egressEnforce=false 降级放行）：${e.message}`)
            return false
        }
        await client.destroySandbox(sandboxId).catch(() => null)
        throw new Error(`出网策略回读失败（502=侧车不存在），已销毁沙箱以避免"以为收紧了其实没收紧"：${e.message}`)
    }
}

/**
 * @description 非池沙箱等 execd 路由真正可用（有界重试）
 *
 * dev 实测（§5.30）：非池 pod 报 `Running` 后，gateway 到 pod:44772 的 execd 路由
 * 还要晚几秒才就绪 —— 首枪 `POST /command` 连吃 3 次 502，第 4 次才通。
 * 池模式因 pod 预热早就在听，从没暴露过这一层；接线到非池必须自己补这次探活，
 * 否则"建箱成功"后第一枪必是 502，把可用性失败推给上层重试。
 * 全部失败即 fail-closed：销毁沙箱并抛错（execd 起不来的箱子留着只会白占资源）。
 * @author xianyang
 * @param {Object} client 沙箱客户端
 * @param {String} sandboxId 沙箱标识
 * @param {Object} [opts] {tries, intervalMs}
 * @returns {Promise<Boolean>}
 */
export async function waitExecdReady(client, sandboxId, opts = {}) {
    const tries = Number(opts.tries) || Number(cfg().execdReadyTries) || 8
    const intervalMs = Number(opts.intervalMs) || Number(cfg().execdReadyIntervalMs) || 3000
    let lastErr = null
    for (let i = 1; i <= tries; i++) {
        try {
            const ret = await client.runCommand({sandboxId, command: 'true', timeoutMs: 15000})
            if (Number(ret.exitCode) === 0) {
                if (i > 1) {
                    logger().info(`execd 第 ${i} 次探活就绪 ${sandboxId}`)
                }
                return true
            }
            lastErr = new Error(`exitCode=${ret.exitCode}`)
        } catch (e) {
            lastErr = e
        }
        if (i < tries) {
            await new Promise(r => setTimeout(r, intervalMs))
        }
    }
    await client.destroySandbox(sandboxId).catch(() => null)
    throw new Error(`execd 探活 ${tries} 次仍不可用，已销毁沙箱 ${sandboxId}：${lastErr ? lastErr.message : '未知'}`)
}

/**
 * @description 建一个沙箱并在用完（含失败）后回收
 * @author xianyang
 * @param {Object} params 入参
 * @param {Function} params.use 拿到 {client, sandboxId} 后执行的逻辑
 * @param {String} [params.poolRef] 池标识
 * @param {Number} [params.timeoutSeconds] 沙箱兜底过期秒数
 * @param {Object} [params.metadata] 打标签用（审计）
 * @returns {Promise<*>} use 的返回值
 */
export async function withSandbox(params = {}) {
    const client = sandboxClient()
    const gate = await assertQuota({userCode: params.userCode, conversationCode: params.conversationCode})
    if (!gate.ok) {
        throw new Error(gate.reason)
    }
    const startedAt = Date.now()
    /** 先算策略再建箱：配置不合法（比如放行内部域名却忘了 serviceCidrs）要在建箱之前就抛 */
    const egress = egressPolicyFromConfig()
    const poolRef = params.poolRef || cfg().defaultPoolRef
    const created = await client.createSandbox(buildCreateBody({
        poolRef,
        egress,
        credentialProxy: Boolean(cfg().credentialProxyEnabled),
        image: params.image || cfg().defaultImage,
        entrypoint: params.entrypoint || cfg().defaultEntrypoint,
        resourceLimits: cfg().defaultResourceLimits,
        timeout: params.timeoutSeconds || cfg().defaultTimeoutSeconds || 600,
        metadata: {via: 'llm-api', ...(params.metadata || {})},
    }))
    const sandboxId = created.sandboxId
    try {
        await verifyEgressPolicy(client, sandboxId, egress)
        if (!poolRef) {
            await waitExecdReady(client, sandboxId)
        }
        return await params.use({client, sandboxId})
    } finally {
        /** 先记账再销毁：销毁失败时秒数也要进配额，否则失败路径反而免费 */
        await recordUsage({
            sandboxId,
            userCode: params.userCode,
            conversationCode: params.conversationCode,
            channel: params.channel,
            poolRef: params.poolRef || cfg().defaultPoolRef,
            usedFor: params.usedFor || 'skill',
            startedAt,
            endedAt: Date.now(),
            releaseReason: 'done',
        })
        await client.destroySandbox(sandboxId).catch(e => {
            logger().warn(`沙箱回收失败 ${sandboxId}：${e.message}（将等 timeout 自动过期，期间占池容量）`)
        })
    }
}

/**
 * @description 在沙箱里执行一个自包含 skill 脚本
 *
 * 沙箱来源两种：给了 conversationCode 就复用该会话的共享沙箱（推荐，见下），
 * 否则临时建一个、用完销毁。为什么默认走复用：**每次执行都建一个沙箱会把池吃光**
 * —— dev 实测 poolMax=3 时连续几次 skill 调用直接 429 KUBERNETES::POOL_CAPACITY_EXHAUSTED，
 * 而且建箱本身要等就绪，比复用慢一个数量级。
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.scriptText 脚本源码
 * @param {String} params.commandName 命令名
 * @param {Object} [params.parameters] 参数
 * @param {String[]} [params.caps] 需要的宿主能力（为空则不签发任何凭据）
 * @param {String} [params.skillName] 仅用于日志与 metadata
 * @param {String} [params.conversationCode] 给了就复用该会话的沙箱
 * @returns {Promise<Object>} skill 脚本返回的结果
 */
export async function executeSkillInSandbox(params = {}) {
    const {scriptText, commandName, parameters = {}, caps = [], skillName = 'skill'} = params
    const check = checkSelfContained(scriptText)
    if (!check.ok) {
        throw new Error(`skill ${skillName} 不是自包含脚本，无法进沙箱：${check.violations.map(v => `${v.source}(${v.reason})`).join('; ')}`)
    }
    const hostCfg = (typeof llm !== 'undefined' ? llm.config?.skillHost : {}) || {}
    const run = async ({client, sandboxId}) => {
        /**
         * 零能力的 skill 很常见（纯计算、纯文本处理），它们不需要也不该拿宿主凭据。
         * 早先版本无条件签发，结果 capability.js 的"至少要带一个能力"把这类 skill 直接打死。
         */
        let token = ''
        if (caps.length) {
            const grant = issueCapabilityToken({
                secret: (typeof llm !== 'undefined' ? llm.config?.cookieSecret : '') || '',
                sandboxId,
                caps,
                ttlMs: hostCfg.tokenTtlMs || 900000,
            })
            token = grant.token
        }
        const bundle = buildSkillBundle({
            scriptText,
            commandName,
            parameters,
            hostBase: caps.length ? hostCfg.baseUrl : '',
            token,
            env: pickEnv(params.env),
        })
        const ret = await client.runCommand({sandboxId, command: bundle.command, timeoutMs: params.timeoutMs})
        const parsed = parseBundleResult(ret.stdout)
        if (!parsed.ok) {
            throw new Error(`skill ${skillName}.${commandName} 在沙箱内失败：${parsed.error}`)
        }
        logger().info(`skill ${skillName}.${commandName} 沙箱执行完成 sandbox=${sandboxId}`)
        return parsed.result
    }
    if (params.conversationCode) {
        const {client, sandboxId} = await getSharedSandbox({conversationCode: params.conversationCode})
        return await run({client, sandboxId})
    }
    return await withSandbox({metadata: {skill: skillName}, use: run})
}

/** 共享沙箱登记：conversationCode -> {sandboxId, expiresAt} */
const shared = new Map()
/** 给配额提供本进程活跃会话沙箱数（跨进程只统计本进程，偏松是已知局限） */
setActiveProvider(() => shared.size)

/**
 * @description 只读窥视该会话当前的共享沙箱标识（无则空串）
 *
 * 给检查点绑定用（PR-16 ②）：**不建箱、不探活、不抛错** ——
 * 检查点在聊天关键路径上登记，任何远端调用都不许混进来。
 * 进程重启后登记表为空是已知局限（与 shared 的进程内语义一致）。
 * @author xianyang
 * @param {String} conversationCode 会话标识
 * @returns {String} sandboxId 或 ''
 */
export function peekSharedSandboxId(conversationCode) {
    const hit = shared.get(conversationCode || 'default')
    return hit?.sandboxId || ''
}

/**
 * @description 取（或建）该会话共用的沙箱，供模型代码多次执行复用
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.conversationCode 会话标识
 * @returns {Promise<Object>} {client, sandboxId}
 */
export async function getSharedSandbox(params = {}) {
    const key = params.conversationCode || 'default'
    const client = sandboxClient()
    const ttlMs = Number(cfg().sharedTtlMs) || 10 * 60 * 1000
    const hit = shared.get(key)
    if (hit && hit.expiresAt > Date.now()) {
        try {
            const d = await client.call(`/sandboxes/${encodeURIComponent(hit.sandboxId)}`)
            const state = String(d?.status?.state || '').toLowerCase()
            if (state === 'running') {
                return {client, sandboxId: hit.sandboxId, reused: true}
            }
            shared.delete(key)
        } catch {
            shared.delete(key)
        }
    }
    const egress = egressPolicyFromConfig()
    const gate = await assertQuota({userCode: params.userCode, conversationCode: key})
    if (!gate.ok) {
        throw new Error(gate.reason)
    }
    /** 计时从"将要建箱"起，不从中途就绪起 —— 建箱+探活等待同样占资源（§5.30 真库行戳出来的） */
    const t0 = Date.now()
    const created = await client.createSandbox(buildCreateBody({
        poolRef: cfg().defaultPoolRef,
        egress,
        credentialProxy: Boolean(cfg().credentialProxyEnabled),
        image: cfg().defaultImage,
        entrypoint: cfg().defaultEntrypoint,
        resourceLimits: cfg().defaultResourceLimits,
        timeout: Math.ceil(ttlMs / 1000) + 60,
        metadata: {via: 'llm-api-run-code', conv: key},
    }))
    await verifyEgressPolicy(client, created.sandboxId, egress)
    if (!cfg().defaultPoolRef) {
        await waitExecdReady(client, created.sandboxId)
    }
    shared.set(key, {
        sandboxId: created.sandboxId,
        expiresAt: Date.now() + ttlMs,
        startedAt: t0,
        userCode: params.userCode || '',
        channel: params.channel || '',
    })
    return {client, sandboxId: created.sandboxId, reused: false}
}

/**
 * @description 在沙箱里跑模型生成的代码
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.code 代码
 * @param {String} [params.lang] python|node（默认 python）
 * @param {String} params.conversationCode 会话
 * @returns {Promise<Object>} {stdout, stderr, exitCode, lang}
 */
export async function runModelCode(params = {}) {
    const lang = ['python', 'node'].includes(String(params.lang || '').toLowerCase()) ? String(params.lang).toLowerCase() : 'python'
    const code = String(params.code || '')
    if (!code.trim()) {
        throw new Error('代码为空，没有可执行内容')
    }
    if (code.length > (Number(cfg().maxCodeChars) || 20000)) {
        throw new Error(`代码超过 ${cfg().maxCodeChars || 20000} 字符上限`)
    }
    const b64 = Buffer.from(code, 'utf8').toString('base64')
    const file = lang === 'python' ? 'main.py' : `main.${pickNodeExt(code)}`
    const runner = lang === 'python' ? 'python3' : 'node'
    const dir = `/tmp/run-${Date.now().toString(36)}`
    const quoted = `'${b64.replace(/'/g, `'\\''`)}'`
    const command = `mkdir -p ${dir} && printf %s ${quoted} | base64 -d > ${dir}/${file} && cd ${dir} && ${runner} ${file}`
    const {client, sandboxId} = await getSharedSandbox({
        conversationCode: params.conversationCode,
        userCode: params.userCode,
        channel: params.channel,
    })
    const ret = await client.runCommand({sandboxId, command, timeoutMs: params.timeoutMs || cfg().execTimeoutMs})
    return {...ret, lang, sandboxId, exitCode: ret.exitCode}
}

/**
 * @description 决定模型给的 node 代码用哪种模块格式落盘
 *
 * dev 实测踩到的契约：沙箱里一律按 `.mjs`（ESM）执行，而模型生成的片段**大量使用
 * `require(...)` / `module.exports`**，直接跑就是 `ReferenceError: require is not
 * defined in ES module scope`。这里按内容选扩展名，而不是强迫模型写对格式。
 * 判据取"是否出现 ESM 语法"，出现则 .mjs；否则出现 CJS 痕迹则 .cjs；都没有则 .mjs
 * （顶层 await 只在 ESM 合法，默认给 ESM 更安全）。
 * @author xianyang
 * @param {String} code 代码文本
 * @returns {String} 'mjs' 或 'cjs'
 */
export function pickNodeExt(code = '') {
    const hasEsm = /(^|[\n;])\s*import\s[\s\S]*?from\s|^export\s|^\s*export\s*\{/m.test(code) || /(^|[\n;])\s*export\s/.test(code)
    if (hasEsm) {
        return 'mjs'
    }
    if (/\brequire\s*\(|module\.exports|__dirname|__filename/.test(code)) {
        return 'cjs'
    }
    return 'mjs'
}

/** 释放某会话的共享沙箱（会话结束或工具报错时调用） */
export async function releaseSharedSandbox(conversationCode) {
    const key = conversationCode || 'default'
    const hit = shared.get(key)
    shared.delete(key)
    if (!hit) {
        return false
    }
    await recordUsage({
        sandboxId: hit.sandboxId,
        userCode: hit.userCode,
        conversationCode: key === 'default' ? '' : key,
        channel: hit.channel,
        poolRef: cfg().defaultPoolRef,
        usedFor: 'run-code',
        startedAt: hit.startedAt,
        endedAt: Date.now(),
        releaseReason: 'quota-release',
    })
    await sandboxClient().destroySandbox(hit.sandboxId).catch(e => {
        logger().warn(`共享沙箱回收失败 ${hit.sandboxId}：${e.message}`)
    })
    return true
}

export default {withSandbox, executeSkillInSandbox, getSharedSandbox, runModelCode, releaseSharedSandbox, pickEnv, pickNodeExt, verifyEgressPolicy, buildCreateBody, waitExecdReady, peekSharedSandboxId, assertPoolPolicyCompatible}
