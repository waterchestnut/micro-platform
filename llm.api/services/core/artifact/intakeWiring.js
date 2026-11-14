/**
 * @fileOverview intake 生产装配（把 artifactIntake 的注入槽接到真件上）
 * @module services/core/artifact/intakeWiring
 * @description
 * PR-H2 execChat 接线的"装配"半边：`makeIntakeRunner` 产出 `executeSaveArtifactTool` 要的
 * `runIntake(task)` 闭包——client/dac/l2Cache/doc.api 全在这里汇合，llmChat 只留薄一行。
 * 判据与编排本体（execdRange/artifactReconcile/artifactIntake）零网络依赖的纪律不因接线而破坏：
 * 本模块**是**那个碰网络的地方，所以它的每个依赖都保持可注入覆盖（tests 传假件走同一函数体）。
 *
 * 三处接线裁定（都有实测/源码依据，写在被裁定的函数旁）：
 * 1. 预热用 **ping 重试环且不销毁**——runner.waitExecdReady 超时销毁是给"建箱路径"的；
 *    会话共享沙箱里一次 502 探活失败不该掀掉用户的工作区（live 实锤过 Running≠可连、2 次才通）。
 * 2. `delete-doc-api-file` 补偿 = **tombstone 覆盖**（同 fileCode 传 0 字节）——doc.api 没有任何删除
 *    接口（HTTP/gRPC 都查过），覆盖语义实测有效；内容销毁=对用户不可用，登记账残留由对账归类处理。
 * 3. 幂等 = **acquireOnce 抑制并发 + idempotencyKey 唯一索引兜底重放**——锁是窗口性的（redis 挂了
 *    放行优先），索引才是持久真相；两层语义不同，缺一不可。模型真重试会带新 toolCallId ⇒ 新键，
 *    本层挡的是框架级重放，不是"用户再点一次"。
 */

import {runIntake} from './artifactIntake.js'
import {makeDocApiUploader} from './docApiUpload.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 全局件一律**函数内**懒取：模块离线可 import（顶层 `const tools = llm.tools` 会让纯测试先炸） */
function globalTools() {
    return (typeof llm !== 'undefined' && llm.tools) || {}
}
function globalConfig() {
    return (typeof llm !== 'undefined' && llm.config) || {}
}
function globalLogger() {
    return (typeof llm !== 'undefined' && llm.logger) || console
}

/**
 * @description 标识生成（getUUID 的薄封装；前缀可读，账里一眼认出类型）
 * @param {String} prefix art|docfile 等
 * @returns {String} 标识
 */
export function genCode(prefix) {
    const t = globalTools()
    const id = typeof t.getUUID === 'function' ? t.getUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    return `${prefix}-${id}`
}

/**
 * @description execd 探活重试环（共享沙箱专用：**失败不销毁**）
 * @param {Object} client 沙箱客户端（callRaw/fileProxyBase）
 * @param {String} sandboxId 沙箱
 * @param {Object} [opts] {tries, intervalMs, timeoutMs}
 * @returns {Promise<Boolean>} 就绪返回 true；超时抛错
 */
export async function pingWaitReady(client, sandboxId, opts = {}) {
    const tries = Number(opts.tries) || 8
    const intervalMs = Number(opts.intervalMs) || 2000
    for (let i = 1; i <= tries; i++) {
        const p = await client.callRaw('/ping', {baseUrl: client.fileProxyBase(sandboxId), timeoutMs: Number(opts.timeoutMs) || 5000}).catch(() => null)
        if (p && p.ok) {
            if (i > 1) globalLogger().info(`intake 预热第 ${i} 次就绪 ${sandboxId}`)
            return true
        }
        if (i < tries) await sleep(intervalMs)
    }
    throw new Error(`execd /ping 探活 ${tries} 次未就绪（共享沙箱保留，仅本次 intake 失败）`)
}

/**
 * @description tombstone：用 0 字节覆盖同 fileCode（doc.api 无删除接口的最接近"删"的既有语义）
 * @param {Object} params {fileCode, docApiConfig, userInfo, fetchImpl}
 * @returns {Promise<Object>} uploader.finish 结果（sizeBytes 必为 0）
 */
export async function tombstoneDocFile({fileCode, docApiConfig, userInfo, fetchImpl} = {}) {
    if (!fileCode) throw new Error('tombstone 需要 fileCode')
    const up = makeDocApiUploader({task: {fileCode, name: 'tombstone.bin', mimeType: 'application/octet-stream'}, config: docApiConfig || {}, userInfo: userInfo || {}, fetchImpl})
    await up.write(Buffer.alloc(0))
    return up.finish()
}

/**
 * @description 组装 runIntake 的 deps（每个键都可被参数覆盖，测试走同一函数体）
 * @param {Object} params 入参
 * @param {Object} params.client 沙箱客户端（sandboxClient() 或假件）
 * @param {Object} params.dac artifactDac（或同形假件）
 * @param {Object} params.docApiConfig doc.api 配置形态
 * @param {Object} params.artifactConfig 产物配置（dedupSeconds/sliceBytes/预热参数等）
 * @param {Object} params.userInfo 落 operator 的身份
 * @param {Function} [params.acquireOnce] SETNX 去重（缺省懒取 l2Cache）
 * @param {Function} [params.streamEvent] (type,payload) 事件桥（缺省不发——账行才是权威）
 * @returns {Object} runIntake 的 deps
 */
export function makeIntakeDeps({client, dac, docApiConfig = {}, artifactConfig = {}, userInfo = {}, acquireOnce, streamEvent} = {}) {
    if (!client || !dac) throw new Error('makeIntakeDeps 需要 client 与 dac')
    const dedupSeconds = Number(artifactConfig.dedupSeconds) || 180
    return {
        idempotentRun: async (key, fn) => {
            if (!key) return fn()
            let acquire = acquireOnce
            if (!acquire) {
                const mod = await import('../../../daos/cache/l2Cache.js')
                acquire = mod.acquireOnce
            }
            const got = await acquire(`artifact-intake:${key}`, dedupSeconds)
            if (!got) {
                // 说清"为什么被跳过、再试该怎么办"：窗口内重放才撞这里，模型真重试是新 toolCallId。
                // dedupSkipped 是**包裹层结论**，刻意不塞进 state 词表（那不是 intake 状态，别污染账/指标口径）
                return {ok: false, dedupSkipped: true, artifactCode: '', failedAt: '', error: `同幂等键在 ${dedupSeconds}s 窗口内已执行过（重放被抑制；确需重存请重新调用 save_artifact）`}
            }
            return fn()
        },
        createRow: (task) => dac.createStarted(task),
        casState: (artifactCode, from, to) => dac.casState(artifactCode, from, to),
        waitExecdReady: (task) => pingWaitReady(client, task.sandboxId, {
            tries: artifactConfig.execdReadyTries,
            intervalMs: artifactConfig.execdReadyIntervalMs,
        }),
        pullFile: ({task, onSlice}) => client.fetchFileBytes({
            sandboxId: task.sandboxId,
            path: task.path,
            sliceBytes: Number(task.sliceBytes) || Number(artifactConfig.sliceBytes) || 1048576,
            maxTotalBytes: task.maxTotalBytes,
            onSlice,
        }),
        beginUpload: ({task}) => makeDocApiUploader({task, config: docApiConfig, userInfo}),
        finalizeRegister: (task, meta) => dac.setRegisterResult(task.artifactCode, meta),
        emitArtifactReady: async (doc) => {
            try {
                await dac.stampReadyAt(doc.artifactCode)
            } catch (e) {
                // readyAt 只是投递时刻的审计戳，写不上不吞 ready 本身（编排侧已 ready）
                globalLogger().warn(`stampReadyAt 失败（不阻断）: ${String(e?.message || e).slice(0, 160)}`)
            }
            if (typeof streamEvent === 'function') {
                streamEvent('artifact_ready', {type: 'artifact_ready', ...doc})
            }
            return doc
        },
        unregisterArtifact: (artifactCode) => dac.markUnregistered(artifactCode),
        deleteDocFile: async (artifactCode, fileCode) => {
            const ret = await tombstoneDocFile({fileCode, docApiConfig, userInfo})
            globalLogger().info(`delete-doc-api-file 以 tombstone 覆盖完成 artifact=${artifactCode} fileCode=${fileCode} size=${ret.sizeBytes}`)
        },
    }
}

/**
 * @description 产出 executeSaveArtifactTool 要的 runIntake(task) 闭包
 * @param {Object} params makeIntakeDeps 的参数；**client/dac 可缺省**——缺省时懒 import 真件
 *   （lazy 是刻意的：默认关 ⇒ 本函数根本不会被调用，dag 连接模块一行都不加载）
 * @returns {Function} async (task) => intake 结果
 */
export function makeIntakeRunner(params = {}) {
    return async (task) => {
        let {client, dac} = params
        if (!client) {
            const mod = await import('../../sandbox/openSandbox.js')
            /** PR-0.3：intake 的 execd 流量也归入本轮 trace（task.runCode=messageCode，装配刀灌的） */
            const trace = task.runCode ? {traceId: String(task.runCode), conversationCode: String(task.conversationCode || '')} : null
            client = mod.sandboxClient(trace ? {trace} : {})
        }
        if (!dac) {
            const mod = await import('../../../daos/core/dac/artifactDac.js')
            dac = mod.default
        }
        return runIntake(task, makeIntakeDeps({...params, client, dac}))
    }
}

/**
 * @description 产出 executeReadArtifactTool 要的 deps（查账 + 整文件读）
 *
 * 读形状来自 live 实测（PR-H2 探针阶段1：GET /file/download?fileCode= + user-info 头 ⇒ 200 字节精确）；
 * 刻意用**内网 base**拼 URL（账行里的 fileUrl 是对外域名，服务器自己走内网）。Range 未实测 ⇒ 整读后切片，
 * 字节上限在 readArtifactTool 执行体里把关。
 * @param {Object} params {dac?, docApiConfig, userInfo, fetchImpl?, timeoutMs?}
 * @returns {Object} {findArtifact, fetchArtifactBytes}
 */
export function makeArtifactReader(params = {}) {
    const base = String(params.docApiConfig?.baseIntranetUrl || params.docApiConfig?.baseUrl || '').replace(/\/+$/, '')
    const timeoutMs = Number(params.docApiConfig?.timeoutMs) || 60000
    const doFetch = params.fetchImpl || ((...args) => fetch(...args))
    return {
        findArtifact: async (artifactCode) => {
            let dac = params.dac
            if (!dac) {
                const mod = await import('../../../daos/core/dac/artifactDac.js')
                dac = mod.default
            }
            return dac.findByArtifactCode(artifactCode)
        },
        fetchArtifactBytes: async (row) => {
            if (!base) throw new Error('docApiConfig 未配置基地址，无法读产物')
            if (!row?.fileCode) throw new Error('账行没有 fileCode，读不了内容')
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeoutMs)
            try {
                const url = `${base}/file/download?fileCode=${encodeURIComponent(row.fileCode)}`
                const res = await doFetch(url, {
                    headers: {'user-info': Buffer.from(encodeURIComponent(JSON.stringify({
                        userCode: params.userInfo?.userCode || '', realName: params.userInfo?.realName || '',
                    })), 'utf8').toString('base64')},
                    signal: controller.signal,
                })
                if (!res.ok) {
                    const text = await res.text().catch(() => '')
                    throw new Error(`doc.api download 返回 ${res.status}${text ? ` ${text.slice(0, 120)}` : ''}`)
                }
                return Buffer.from(await res.arrayBuffer())
            } finally {
                clearTimeout(timer)
            }
        },
    }
}

export default {genCode, pingWaitReady, tombstoneDocFile, makeIntakeDeps, makeIntakeRunner, makeArtifactReader}
