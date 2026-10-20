/**
 * @fileOverview OpenSandbox 客户端（lifecycle API + 沙箱内 execd API）
 * @module services/sandbox/openSandbox
 * @description 计划里的硬约束在这里落实：沙箱只承接"执行模型生成的代码/命令"，
 * 记忆读写、装配、promote 全留在 llm.api 进程内；本模块只是一层 HTTP 客户端。
 *
 * 契约取自上游 specs（release-1.2.0-rc.1，已逐条比对）：
 *   lifecycle  baseUrl 末尾含 /v1；POST /sandboxes→202、GET /sandboxes/{id}、
 *             GET /sandboxes/{id}/endpoints/{port} 拿 execd 入口、DELETE→204、
 *             鉴权头 `OPEN-SANDBOX-API-KEY`；错误码含 401/403/404/409/429/503。
 *   execd      每沙箱独立端点：POST /command 跑命令、/files/*、/ping。
 *
 * 三个刻意的设计：
 * 1. **工厂 + 注入 fetch**：没有真集群也能把 URL/头/体/轮询/清理逻辑测干净；
 * 2. **createSandbox 失败也要回收**：拿到 id 之后任何一步抛错，都尽力 DELETE，
 *    否则 dev 集群里会积一堆没人回收的沙箱占着池；
 * 3. **execd 端点解析失败要带上下文**：网关地址（含 scheme 与否）配错是最常见的部署故障，
 *    错误信息里必须出现实际用的地址。
 */

const DEFAULTS = {
    requestTimeoutMs: 20000,
    readyTimeoutMs: 120000,
    readyIntervalMs: 1500,
    execTimeoutMs: 120000,
    apiKeyHeader: 'OPEN-SANDBOX-API-KEY',
    destroyOnError: true,
    /** 网关返回的入口不带协议，这里补；生产走 TLS 时改成 https */
    endpointScheme: 'http',
    /** execd 访问令牌（平台配了才需要），作为 X-EXECD-ACCESS-TOKEN 发出 */
    execdAccessToken: '',
    /** egress 侧车端口（上游 egress-api.yaml 的 local url 是 18080），/policy 与 /credential-vault 都在它上面 */
    egressPort: 18080,
    /** 侧车可能要求 OPENSANDBOX-EGRESS-AUTH；入口解析返回的 headers 无论如何都会一并转发 */
    egressAuthToken: '',
}

/** 去掉尾部斜杠，避免拼出 //v1 */
function trimSlash(s) {
    return String(s || '').replace(/\/+$/, '')
}

/** 上游 lifecycle 的 base 末尾带 /v1；这里容忍配成带或不带 */
function lifecycleBase(cfg) {
    const base = trimSlash(cfg.baseUrl || cfg.baseIntranetUrl || '')
    if (!base) {
        throw new Error('sandboxConfig.baseUrl 未配置，无法访问 OpenSandbox')
    }
    return /\/v1$/.test(base) ? base : `${base}/v1`
}

function statusHint(code) {
    const map = {
        400: '请求体不符合 OpenSandbox 契约',
        401: '鉴权失败：检查 OPEN-SANDBOX-API-KEY 与集群 Secret 是否一致',
        403: '无权限：检查该项目/命名空间的 RBAC',
        404: '对象不存在：沙箱可能已被 expireTime 回收',
        409: '冲突：同名资源已存在或状态不允许该操作',
        429: '配额/限流：检查 sandbox-seconds 配额与并发',
        501: '该能力未实现（如 isolated/diff/commit 需要额外后端）',
        503: '依赖未就绪（如 artifact store、egress 组件）',
    }
    return map[code] || ''
}

/**
 * execd `/command` 的 200 响应在 spec 里没有 schema（`responses."200": {}`），
 * 字段名靠 dev 实测确定，见下面 parseCommandStream 的注释。
 */

/**
 * execd `POST /command` 的响应形状：**dev 实测确认**（1.2.0-rc.1）返回的是**字符串形式的 NDJSON 事件流**，
 * 事件之间用空行分隔，spec 里没有 schema 所以只能实测：
 *   {"type":"init","text":"<执行id>","timestamp":...}
 *   {"type":"ping","text":"pong",...}
 *   {"type":"stdout","text":"...",...}          stderr 同理
 *   {"type":"error","error":{"ename":"CommandExecError","evalue":"3","traceback":["exit status 3"]}}
 *   {"type":"execution_complete","execution_time":134,...}
 * 非零退出码在 `error.evalue` 里（没有 exitCode 字段）。
 */
export function parseCommandStream(payload) {
    const out = {stdout: '', stderr: '', exitCode: 0, executionId: null, executionTimeMs: null, events: [], raw: payload == null ? '' : String(payload)}
    if (!out.raw) {
        return out
    }
    const lines = out.raw.split(/\r?\n/).filter(l => l.trim())
    const so = []
    const se = []
    for (const line of lines) {
        let ev = null
        try {
            ev = JSON.parse(line)
        } catch {
            /** 不是 JSON 的行按 stdout 兜底，宁可不丢内容 */
            so.push(line)
            continue
        }
        out.events.push(ev)
        switch (ev.type) {
            case 'init':
                out.executionId = ev.text || null
                break
            case 'stdout':
                so.push(String(ev.text ?? ''))
                break
            case 'stderr':
                se.push(String(ev.text ?? ''))
                break
            case 'error': {
                se.push(String(ev?.error?.evalue ?? ev?.error?.ename ?? 'error'))
                const code = Number(ev?.error?.evalue)
                if (Number.isFinite(code)) {
                    out.exitCode = code
                } else if (ev?.error?.ename) {
                    /** 有 ename 但没有可读退出码：按失败处理，不能报成功 */
                    out.exitCode = 1
                }
                break
            }
            case 'execution_complete':
                out.executionTimeMs = Number(ev.execution_time) ?? null
                break
            default:
                break
        }
    }
    out.stdout = so.join('\n')
    out.stderr = se.join('\n')
    return out
}

/**
 * @description 创建一个 OpenSandbox 客户端
 * @author xianyang
 * @param {Object} [options] 配置（缺省读 llm.config.sandboxConfig）
 * @param {Function} [options.fetchImpl] 注入的 fetch，便于测试
 * @returns {Object} 客户端
 */
export function createSandboxClient(options = {}) {
    const fromGlobal = (typeof llm !== 'undefined' && llm.config?.sandboxConfig) ? llm.config.sandboxConfig : {}
    const cfg = {...DEFAULTS, ...fromGlobal, ...options}
    const doFetch = options.fetchImpl || ((...args) => fetch(...args))
    if (!cfg.apiKey) {
        // 不抛错：可能由环境/Secret 稍后注入；但每次请求都会 401，所以这里显式告警更划算
        const warn = (typeof llm !== 'undefined' && llm.logger?.warn) ? llm.logger.warn.bind(llm.logger) : console.warn
        warn('sandboxConfig.apiKey 未配置，调用 OpenSandbox 一定返回 401')
    }

    async function call(path, {method = 'GET', body, baseUrl, timeoutMs, headers} = {}) {
        const url = `${trimSlash(baseUrl || lifecycleBase(cfg))}${path}`
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), Number(timeoutMs || cfg.requestTimeoutMs))
        const init = {
            method,
            signal: controller.signal,
            headers: {
                'content-type': 'application/json',
                [cfg.apiKeyHeader]: cfg.apiKey || '',
                ...(headers || {}),
            },
        }
        if (body !== undefined) {
            init.body = JSON.stringify(body)
        }
        let res
        try {
            res = await doFetch(url, init)
        } catch (e) {
            const why = e && e.name === 'AbortError' ? `超时 ${timeoutMs || cfg.requestTimeoutMs}ms` : (e && e.message ? e.message : String(e))
            throw new Error(`OpenSandbox ${method} ${url} 请求失败：${why}`)
        } finally {
            clearTimeout(timer)
        }
        const text = res.status === 204 ? '' : await res.text().catch(() => '')
        if (!res.ok) {
            const hint = statusHint(res.status)
            throw new Error(`OpenSandbox ${method} ${url} 返回 ${res.status}${hint ? `：${hint}` : ''}${text ? ` ${text.slice(0, 200)}` : ''}`)
        }
        if (!text) {
            return null
        }
        try {
            return JSON.parse(text)
        } catch {
            return text
        }
    }

    /**
     * @description 建沙箱并等它可用
     * @param {Object} spec 传给 POST /sandboxes 的请求体
     * @returns {Promise<Object>} {sandboxId, detail, endpointBase}
     */
    async function createSandbox(spec = {}) {
        const created = await call('/sandboxes', {method: 'POST', body: spec, timeoutMs: cfg.createTimeoutMs || Math.max(cfg.requestTimeoutMs, 60000)})
        const sandboxId = created?.sandboxId || created?.id || created?.sandbox?.sandboxId || created?.name
        if (!sandboxId) {
            throw new Error(`OpenSandbox 创建响应里没有沙箱标识：${JSON.stringify(created).slice(0, 200)}`)
        }
        try {
            const detail = await waitReady(sandboxId)
            return {sandboxId, detail, created}
        } catch (e) {
            if (cfg.destroyOnError) {
                await destroySandbox(sandboxId).catch(() => null)
            }
            throw e
        }
    }

    /**
     * @description 轮询到沙箱可用
     * @param {String} sandboxId 沙箱标识
     * @returns {Promise<Object>} 最后一次详情
     */
    async function waitReady(sandboxId) {
        const deadline = Date.now() + Number(cfg.readyTimeoutMs)
        let last = null
        for (;;) {
            last = await call(`/sandboxes/${encodeURIComponent(sandboxId)}`, {timeoutMs: cfg.requestTimeoutMs})
            const state = String(last?.state || last?.status?.state || last?.phase || '').toLowerCase()
            if (['running', 'ready', 'available', 'bound'].includes(state)) {
                return last
            }
            if (['failed', 'error', 'deleted', 'expired'].includes(state)) {
                throw new Error(`沙箱 ${sandboxId} 进入终态 ${state}`)
            }
            if (Date.now() > deadline) {
                throw new Error(`等待沙箱 ${sandboxId} 就绪超时（${cfg.readyTimeoutMs}ms），最后状态=${state || '未知'}`)
            }
            await new Promise(r => setTimeout(r, Number(cfg.readyIntervalMs)))
        }
    }

    /**
     * @description 取沙箱内某端口的访问入口（execd 就走这里）
     *
     * 真实响应（dev 实测，1.2.0-rc.1 + gatewayRouteMode=header）：
     *   {"endpoint":"192.168.31.152:30988","headers":{"OpenSandbox-Ingress-To":"<sandboxId>-44772"}}
     * 两个坑都在这：**endpoint 不带 scheme**（server 配置侧刻意禁止带 scheme，由客户端决定 http/https），
     * 以及**必须带上返回的 headers**，否则网关不知道该把请求转给哪个沙箱。
     * @param {String} sandboxId 沙箱标识
     * @param {Number|String} port 端口
     * @returns {Promise<Object>} {url, headers, raw}
     */
    async function endpoint(sandboxId, port) {
        const ret = await call(`/sandboxes/${encodeURIComponent(sandboxId)}/endpoints/${port}`, {timeoutMs: cfg.requestTimeoutMs})
        const raw = typeof ret === 'string' ? ret : (ret?.endpoint || ret?.url || ret?.address || ret?.target || '')
        if (!raw) {
            throw new Error(`沙箱 ${sandboxId} 端口 ${port} 未返回可用入口：${JSON.stringify(ret).slice(0, 200)}`)
        }
        const url = addScheme(trimSlash(raw), cfg.endpointScheme || 'http')
        return {url, headers: (ret && ret.headers) || {}, raw}
    }

    /** 给不带协议的入口补上 scheme */
    function addScheme(v, scheme) {
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
            return v
        }
        return `${scheme}://${v}`
    }

    /**
     * @description 在沙箱里执行命令
     * @param {Object} params 入参
     * @param {String} params.sandboxId 沙箱标识
     * @param {String|String[]} params.command 命令（字符串按 sh -c 传，数组原样传）
     * @param {Object} [params.env] 环境变量
     * @param {Number} [params.port] execd 端口，缺省取配置
     * @returns {Promise<Object>} {stdout, stderr, exitCode, raw}
     */
    /**
     * @description 在沙箱里执行一条命令
     *
     * execd 的真实契约（RunCommandRequest，1.2.0-rc.1 实测 + spec 双向确认）：
     *   `command` 是**shell 字符串**，数组要走 **`argv`**（两者互斥，二选一）；
     *   环境变量键名是 **`envs`** 而不是 env；另有 cwd/background/timeout(ms)/uid/gid。
     * 之前发 {command: [...], env:{}} 会被 Go 侧报 "cannot unmarshal array into ... command of type string"。
     * @param {Object} params 入参
     * @param {String} params.sandboxId 沙箱标识
     * @param {String|String[]} params.command 命令：字符串按 shell 执行，数组按 argv 原样执行
     * @param {Object} [params.envs] 注入的环境变量（键名按契约是 envs）
     * @param {String} [params.cwd] 工作目录
     * @param {Number} [params.timeoutMs] execd 侧强制终止的毫秒数
     * @param {Boolean} [params.background] 是否后台执行
     * @returns {Promise<Object>} {stdout, stderr, exitCode, endpoint, raw}
     */
    async function runCommand(params = {}) {
        const {sandboxId, command, envs, env, cwd, background, uid, gid} = params
        if (!sandboxId || !command) {
            throw new Error('runCommand 需要 sandboxId 与 command')
        }
        const ep = await endpoint(sandboxId, params.port || cfg.execdPort || 44772)
        const body = {}
        if (Array.isArray(command)) {
            body.argv = command.map(String)
        } else {
            body.command = String(command)
        }
        const envOut = envs || env
        if (envOut && Object.keys(envOut).length) {
            body.envs = envOut
        }
        if (cwd) {
            body.cwd = cwd
        }
        if (background) {
            body.background = true
        }
        if (uid !== undefined && gid !== undefined) {
            body.uid = uid
            body.gid = gid
        }
        const execTimeoutMs = Number(params.timeoutMs || cfg.execTimeoutMs)
        /** execd 自己会强制终止，留一点余量给网络往返，避免两端同时超时后拿不到退出码 */
        if (execTimeoutMs > 1000) {
            body.timeout = execTimeoutMs - 1000
        }
        const headers = {...ep.headers}
        const token = params.accessToken || cfg.execdAccessToken
        if (token) {
            headers['X-EXECD-ACCESS-TOKEN'] = token
        }
        const raw = await call('/command', {
            method: 'POST',
            body,
            baseUrl: ep.url,
            headers,
            timeoutMs: execTimeoutMs,
        })
        const parsed = parseCommandStream(raw)
        return {
            stdout: parsed.stdout,
            stderr: parsed.stderr,
            exitCode: parsed.exitCode,
            executionId: parsed.executionId,
            executionTimeMs: parsed.executionTimeMs,
            endpoint: ep.url,
            request: body,
            raw,
        }
    }

    /**
     * @description 等沙箱进入指定状态之一
     * pause 是异步的：202 只代表"已接受"，随后会经过 Pausing，到 Paused 才能 resume
     * （未等到就 resume 会得到 409 KUBERNETES::INVALID_STATE "operation in progress"，dev 实测）。
     * @param {String} sandboxId 沙箱标识
     * @param {String[]} states 期望状态（大小写不敏感）
     * @param {Number} [timeoutMs] 等待上限
     * @returns {Promise<Object>} 最后一次详情
     */
    async function waitState(sandboxId, states = [], timeoutMs) {
        const want = states.map(s => String(s).toLowerCase()).filter(Boolean)
        const deadline = Date.now() + Number(timeoutMs || cfg.readyTimeoutMs)
        let last = null
        for (;;) {
            last = await call(`/sandboxes/${encodeURIComponent(sandboxId)}`, {timeoutMs: cfg.requestTimeoutMs})
            const state = String(last?.status?.state || last?.state || '').toLowerCase()
            if (want.includes(state)) {
                return last
            }
            if (Date.now() > deadline) {
                throw new Error(`等待沙箱 ${sandboxId} 进入 ${states.join('/')} 超时（${timeoutMs || cfg.readyTimeoutMs}ms），当前=${state || '未知'}`)
            }
            await new Promise(r => setTimeout(r, Number(cfg.readyIntervalMs)))
        }
    }

    /**
     * @description 回收沙箱
     * @param {String} sandboxId 沙箱标识
     * @returns {Promise<null>}
     */
    async function destroySandbox(sandboxId) {
        if (!sandboxId) {
            return null
        }
        return await call(`/sandboxes/${encodeURIComponent(sandboxId)}`, {method: 'DELETE', timeoutMs: cfg.requestTimeoutMs})
    }

    /**
     * @description 健康探测（/health 免鉴权，可用作部署自检）
     * @returns {Promise<Boolean>} 是否可用
     */
    async function health() {
        const base = trimSlash(cfg.baseUrl || cfg.baseIntranetUrl || '')
        if (!base) {
            return false
        }
        try {
            await call('/health', {baseUrl: base, timeoutMs: 5000, headers: {}})
            return true
        } catch {
            return false
        }
    }

    /**
     * @description 暂停沙箱并等它真的进入 Paused（202 只代表已接受，之后还有 Pausing）
     * @param {String} sandboxId 沙箱标识
     * @param {Object} [opts] {wait:true, timeoutMs}
     * @returns {Promise<Object>} 最后详情
     */
    async function pause(sandboxId, opts = {}) {
        await call(`/sandboxes/${encodeURIComponent(sandboxId)}/pause`, {method: 'POST', timeoutMs: cfg.requestTimeoutMs})
        if (opts.wait === false) {
            return null
        }
        return await waitState(sandboxId, ['paused'], opts.timeoutMs)
    }

    /**
     * @description 恢复沙箱（先把可能仍在进行的暂停动作等完，否则 409）
     * @param {String} sandboxId 沙箱标识
     * @returns {Promise<Object>} 恢复后的详情
     */
    async function resume(sandboxId) {
        /** Pausing 中间态直接 resume 会被拒，所以先等 Paused 再发 */
        const cur = await call(`/sandboxes/${encodeURIComponent(sandboxId)}`, {timeoutMs: cfg.requestTimeoutMs})
        const state = String(cur?.status?.state || cur?.state || '').toLowerCase()
        if (state === 'pausing') {
            await waitState(sandboxId, ['paused'], cfg.readyTimeoutMs)
        }
        await call(`/sandboxes/${encodeURIComponent(sandboxId)}/resume`, {method: 'POST', timeoutMs: cfg.requestTimeoutMs})
        return await waitReady(sandboxId)
    }

    /**
     * @description 主动续期（上游要求 expiresAt 是**未来的 RFC3339 时刻**，客户端先校验再发）
     * @param {String} sandboxId 沙箱标识
     * @param {String|Date} expiresAt 新的绝对过期时刻
     * @returns {Promise<Object>} {expiresAt}
     */
    async function renewExpiration(sandboxId, expiresAt) {
        const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
        if (!Number.isFinite(d.getTime())) {
            throw new Error(`renewExpiration 的 expiresAt 不是合法时间：${String(expiresAt).slice(0, 40)}`)
        }
        if (d.getTime() <= Date.now()) {
            throw new Error(`renewExpiration 的 expiresAt 必须在未来（上游契约），收到 ${d.toISOString()}`)
        }
        /** 契约是 {expiresAt} 且 additionalProperties:false，别多塞字段 */
        return await call(`/sandboxes/${encodeURIComponent(sandboxId)}/renew-expiration`, {
            method: 'POST',
            body: {expiresAt: d.toISOString()},
            timeoutMs: cfg.requestTimeoutMs,
        })
    }

    /**
     * @description 为沙箱建快照
     * @param {String} sandboxId 沙箱标识
     * @param {String} [name] 可读名称（CreateSnapshotRequest 只认这一个字段）
     * @returns {Promise<Object>} Snapshot
     */
    async function createSnapshot(sandboxId, name) {
        /** additionalProperties: false —— 传 name 以外的字段会被拒 */
        const body = name ? {name: String(name)} : {}
        return await call(`/sandboxes/${encodeURIComponent(sandboxId)}/snapshots`, {
            method: 'POST',
            body,
            timeoutMs: cfg.requestTimeoutMs,
        })
    }

    /**
     * @description 等快照到 Ready（Creating/Deleting 是中间态）
     * @param {String} snapshotId 快照标识
     * @returns {Promise<Object>} 快照
     */
    async function waitSnapshotReady(snapshotId) {
        const deadline = Date.now() + Number(cfg.readyTimeoutMs)
        let last = null
        for (;;) {
            last = await call(`/snapshots/${encodeURIComponent(snapshotId)}`, {timeoutMs: cfg.requestTimeoutMs})
            const state = String(last?.status?.state || last?.state || '').toLowerCase()
            if (state === 'ready') {
                return last
            }
            if (state === 'failed' || state === 'deleted') {
                throw new Error(`快照 ${snapshotId} 进入 ${state}：${last?.status?.reason || ''}`)
            }
            if (Date.now() > deadline) {
                throw new Error(`等待快照 ${snapshotId} Ready 超时（${cfg.readyTimeoutMs}ms），最后状态=${state || '未知'}`)
            }
            await new Promise(r => setTimeout(r, Number(cfg.readyIntervalMs)))
        }
    }

    /**
     * @description 取快照详情
     * @param {String} snapshotId 快照标识
     * @returns {Promise<Object>} 快照
     */
    async function getSnapshot(snapshotId) {
        return await call(`/snapshots/${encodeURIComponent(snapshotId)}`, {timeoutMs: cfg.requestTimeoutMs})
    }

    /**
     * @description 删除快照
     * @param {String} snapshotId 快照标识
     * @returns {Promise<null>}
     */
    async function deleteSnapshot(snapshotId) {
        return await call(`/snapshots/${encodeURIComponent(snapshotId)}`, {method: 'DELETE', timeoutMs: cfg.requestTimeoutMs})
    }

    /**
     * @description 列快照（响应是 {items, pagination}）
     * @param {Object} [query] 透传的查询参数（如 pageSize）
     * @returns {Promise<Object[]>} 快照数组
     */
    async function listSnapshots(query = {}) {
        const qs = new URLSearchParams(query).toString()
        const ret = await call(`/snapshots${qs ? `?${qs}` : ''}`, {timeoutMs: cfg.requestTimeoutMs})
        return ret?.items || (Array.isArray(ret) ? ret : [])
    }

    /**
     * @description 读沙箱当前网络策略（lifecycle 侧代理到沙箱内 egress 侧车）
     *
     * 为什么不在 create 里带 policy：**池模式（extensions.poolRef）明确不接受 networkPolicy**
     * —— server 无法给单个 allocation 注侧车，两个字段同时给会被拒（上游 create schema 1837 行）。
     * 所以我们只能建箱后 PUT。
     * @param {String} sandboxId 沙箱标识
     * @returns {Promise<Object>} {defaultAction, egress, mode, enforcementMode}
     */
    async function getNetworkPolicy(sandboxId) {
        return await call(`/sandboxes/${encodeURIComponent(sandboxId)}/networkpolicy`, {timeoutMs: cfg.requestTimeoutMs})
    }

    /**
     * @description 整体替换沙箱网络策略（PUT 是 replace，不是 merge；merge 要用侧车的 PATCH）
     * @param {String} sandboxId 沙箱标识
     * @param {Object} policy {defaultAction, egress:[{action,target}]}
     * @returns {Promise<Object>} 侧车返回的策略状态
     */
    async function replaceNetworkPolicy(sandboxId, policy = {}) {
        return await call(`/sandboxes/${encodeURIComponent(sandboxId)}/networkpolicy`, {
            method: 'PUT', body: policy, timeoutMs: cfg.requestTimeoutMs,
        })
    }

    /**
     * @description 直连沙箱内 egress 侧车（/policy、/credential-vault 都在它上面，不在 lifecycle）
     *
     * 访问方式是两步（上游 egress-api.yaml 的 Access Model）：先用 lifecycle 解析 egress 端口的入口，
     * 再直接打它的 `/policy` 或 `/credential-vault`；入口返回的 headers 必须转发，否则网关找不到沙箱。
     * @param {String} sandboxId 沙箱标识
     * @param {String} path 侧车路径，如 /policy、/credential-vault
     * @param {Object} [opts] {method, body, timeoutMs}
     * @returns {Promise<Object>} 解析后的响应
     */
    async function egressCall(sandboxId, path, opts = {}) {
        const ep = await endpoint(sandboxId, cfg.egressPort || 18080)
        const headers = {...(ep.headers || {})}
        if (cfg.egressAuthToken) {
            headers['OPENSANDBOX-EGRESS-AUTH'] = cfg.egressAuthToken
        }
        return await call(path, {
            method: opts.method || 'GET',
            body: opts.body,
            baseUrl: ep.url,
            headers,
            timeoutMs: opts.timeoutMs || cfg.requestTimeoutMs,
        })
    }

    /**
     * @description 建沙箱本地 Credential Vault（凭据只写不读，响应里永远是脱敏元数据）
     *
     * 前置条件由上游写死：侧车必须跑在 `dns+nft` 且**必须已有 egress policy**，
     * 否则回 412；`defaultAction: deny` 是强推荐（default-allow 目前仍支持但带安全告警）。
     * 另注意 Vault 的绑定匹配**只在 80/443 生效**，其它端口会解密但不注入凭据。
     * @param {String} sandboxId 沙箱标识
     * @param {Object} body CredentialVaultCreateRequest
     * @returns {Promise<Object>} 脱敏后的 vault 状态
     */
    async function createCredentialVault(sandboxId, body = {}) {
        return await egressCall(sandboxId, '/credential-vault', {method: 'POST', body})
    }

    /**
     * @description 取脱敏的 Credential Vault 状态（也用作"这台到底支不支持 vault"的探针）
     * @param {String} sandboxId 沙箱标识
     * @returns {Promise<Object>} 状态或原始错误
     */
    async function getCredentialVault(sandboxId) {
        return await egressCall(sandboxId, '/credential-vault')
    }

    return {cfg, createSandbox, waitReady, waitState, endpoint, runCommand, destroySandbox, health, call,
        pause, resume, renewExpiration, createSnapshot, waitSnapshotReady, getSnapshot, deleteSnapshot, listSnapshots,
        getNetworkPolicy, replaceNetworkPolicy, egressCall, createCredentialVault, getCredentialVault,
        parseCommandStream}
}

/**
 * @description 用全局配置建一个客户端
 * @author xianyang
 * @param {Object} [options] 覆盖项
 * @returns {Object} 客户端
 */
export function sandboxClient(options = {}) {
    return createSandboxClient(options)
}

export default {createSandboxClient, sandboxClient, DEFAULTS}
