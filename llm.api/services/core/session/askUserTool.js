/**
 * @fileOverview ask_user 挂起提问（PR-E 装配：MRTR 形状、进程内等待、答复经控制通道投给 run）
 * @module services/core/session/askUserTool
 * @description
 * 模型经 `ask_user` 出题 ⇒ run **原地挂起等答复**（MCP elicitation 语义：上游不计费，SSE 保留），
 * 人的答复从**任意 worker** 的 `/answer` 走 `chat:ctl:answer:*` 族通道投到 run 所在进程。
 * 为什么不做"落档退出、答完再续"：续跑机制（cp 读侧）不存在，为它现开一台手术会把这刀拖肥；
 * 挂起的成本只是一个 async 资源与一条连接，超时线兜住最坏情况。**形状与理想型的差异记录在案**。
 *
 * 判据全部复用 `mrtrPayload.js`（cdd5535 的契约件），本件只做**有状态的外壳**：
 *   - 一次性消费的权威在 run 侧 router——`alreadyAnsweredBy` 这本账只存在于 run 的内存里，
 *     路由侧（可能在另一个 worker）无从知晓，它的验签+归属预检只是快速失败，不是裁决；
 *   - 先到先得：首答 settle 后条目转为**回执（tombstone）**保留到 run 结束——
 *     迟到者的 deliver 命中回执得到 already-answered（回执数被"每轮最多 8 问"封顶，不会胀）；
 *   - `kind:'approval'` 只认发起人（decideAnswerAdmission 的保守裁定，§2F.4 前不放开）；
 *   - 答复的 schema 权威校验也在 run 侧：出题的 requests 在这里，路由侧要求这份数据
 *     就得跨 worker 复制状态——复制的判据是漂移的开始（ajv 三副本教训）。
 * 三件套防的是同一种错：把"我这一侧看不全"伪装成"这事不存在"。
 */

import {validateInputRequests, sealRequestState, buildAwaitInputPayload, validateAnswerPayload, decideAnswerAdmission} from './mrtrPayload.js'

export const ASK_TOOL_NAME = 'ask_user'
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

/**
 * @description 答复续体的签名密钥。与 capabilitySecret 同一把（cookieSecret）但**不回 import 沙箱模块**——
 *  语义不同的东西共用实现文件里的一个函数名，比共用密钥本身更容易被错误重构拆开。
 * @returns {String} 密钥（未配置为空串，调用方必须挡住）
 */
export function answerSecret() {
    return (typeof llm !== 'undefined' ? llm.config?.cookieSecret : '') || ''
}

/**
 * @description 构造 ask_user 工具定义（模型侧契约）
 * @returns {Object[]} tools 数组片段
 */
export function buildAskTools() {
    return [{
        type: 'function',
        function: {
            name: ASK_TOOL_NAME,
            description: [
                '向用户提问并等待答复（人的回复会作为本工具的结果返回）。',
                '用于：关键信息缺失、方案分叉要人拍板、动手前的确认。',
                'inputRequests 是 MRTR 形状：form 模式给 requestedSchema（JSON Schema 子集，type/enum/required）；',
                'url 模式给 http(s) 链接（人在外部页面完成）。',
                '凭据类字段（密码/token/密钥）**禁止**放 form——那会把秘密送进模型上下文，服务端会拒绝出题。',
                'kind 可选 question（默认）/approval：approval 是批准类，只接受发起人本人确认。',
                '一次最多 8 问；不要用它闲聊，能自己合理推进的事不要问。',
            ].join(''),
            parameters: {
                type: 'object',
                properties: {
                    inputRequests: {
                        type: 'array',
                        description: '要问的事（1..8 条），每条 {mode?, message, requestedSchema?|url?}',
                        items: {type: 'object'},
                    },
                    kind: {type: 'string', enum: ['question', 'approval'], description: '问题性质，缺省 question'},
                },
                required: ['inputRequests'],
            },
        },
    }]
}

/**
 * @description 是否 ask_user 工具
 * @param {String} toolName 工具名
 * @returns {Boolean} 是否是
 */
export function isAskTool(toolName) {
    return toolName === ASK_TOOL_NAME
}

/**
 * @description 该不该启用提问面（默认关）。注意**出题与答题是同一个开关**：
 *  能问不能答=把 run 挂死，能答不能问=空转路由，拆开两个开关只会配错。
 * @param {Object} [controlConfig] `llm.config.controlConfig`
 * @returns {Boolean} 是否启用
 */
export function askToolEnabled(controlConfig = {}) {
    return controlConfig?.askEnabled === true
}

/**
 * @description 把多个 form 问题的字段合成一张答题网（一次性回答整组问题）
 *  url 模式条目无字段可答（人在外部完成），不进 schema。
 * @param {Object[]} requests validateInputRequests 的归一产物
 * @returns {Object|null} 合并后的 {properties, required}，全 url 时 null
 */
function mergeFormSchema(requests = []) {
    const properties = {}
    const required = []
    for (const r of requests) {
        if (r?.mode !== 'form') continue
        const props = r.requestedSchema?.properties || {}
        for (const [k, v] of Object.entries(props)) {
            properties[k] = v
        }
        if (Array.isArray(r.requestedSchema?.required)) {
            for (const k of r.requestedSchema.required) {
                if (!required.includes(k)) required.push(k)
            }
        }
    }
    return Object.keys(properties).length ? {properties, required} : null
}

/**
 * @description 构造 run 侧答复路由器（每个开了 ask 的 run 一个；挂在控制通道把手上）
 * @param {Object} deps {runCode, initiator, secret, logger, emitAck}
 * @returns {{runCode:String, register:Function, deliver:Function, stats:Object, ackSnapshot:Function}} 路由器
 *
 * `register` 返回 promise（resolve 即答复/取消的终局）；`deliver` 是通道订阅侧的投递口。
 * 裁决全在同步代码段里（Map 查改 + settle），没有 await 插队面——先到先得的"先"由单线程定序。
 *
 * **P-19（2026-11-15 裁定）：每次 deliver 的终局——采纳或拒绝——都发一条 `answer_ack`**
 * （经 deps.emitAck，同一 run 的事件通道；断线者 /resume 可见，并留 ackSnapshot 给档案面）。
 * 裁决与回执是两个身份：emitAck 抛错只吞不理——**回执发不出去不许反过来影响裁决**，
 * 反之亦然；"已投递"从此有了对偶的"被怎样了"，被正当拒的答复人不再只能靠干等发现
 * （首版 ask-e2e 探针就是这条缺口的受害者，立案原文）。
 */
export function createAnswerRouter({runCode = '', initiator = '', secret = '', logger = null, emitAck = null} = {}) {
    if (!runCode) throw new Error('createAnswerRouter 需要 runCode（无 run 就没有答复的去处）')
    /** askId -> {state:'open'|'answered', kind, schema, requestState, answeredBy, finish?} */
    const entries = new Map()
    const stats = {issued: 0, answered: 0, cancelled: 0, rejected: 0}
    /** ack 留档（档案面 extInfo.awaitings 的来源）：有界——长 run 被刷屏不许撑爆内存 */
    const ackLog = []
    const ACK_CAP = 32
    function emitAckNow(ack) {
        const row = {...ack, at: new Date().toISOString()}
        if (ackLog.length >= ACK_CAP) {
            ackLog.shift()
        }
        ackLog.push(row)
        if (typeof emitAck === 'function') {
            try {
                emitAck(row)
            } catch { /* 回执通道故障只丢回执（见头部裁定的两个身份） */ }
        }
    }

    /**
     * @description 登记一问并返回等待 promise
     * @param {Object} p {askId, kind, schema, requestState, timeoutMs, signal}
     * @returns {Promise<Object>} 终局 {resultType:'complete', responses, answeredBy} | {resultType:'cancelled', reason}
     */
    function register({askId, kind = 'question', schema = null, requestState = '', timeoutMs = DEFAULT_TIMEOUT_MS, signal = undefined} = {}) {
        if (!askId || !requestState) {
            throw new Error('register 需要 askId 与 requestState')
        }
        stats.issued++
        return new Promise((resolve) => {
            let settled = false
            const finish = (outcome) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                if (signal && onAbort) {
                    signal.removeEventListener('abort', onAbort)
                }
                const e = entries.get(askId)
                if (e && e.state === 'open') {
                    // 取消/超时不留回执：条目已从"可答"变"不存在"，迟到的 deliver 得到 no-such-request，
                    // 这比谎称 already-answered 诚实——没有人答过它。
                    entries.delete(askId)
                }
                if (outcome.resultType === 'complete') stats.answered++
                else stats.cancelled++
                resolve(outcome)
            }
            const timer = setTimeout(() => finish({resultType: 'cancelled', reason: 'timeout'}), timeoutMs)
            let onAbort = null
            if (signal) {
                if (signal.aborted) {
                    finish({resultType: 'cancelled', reason: 'client-gone'})
                    return
                }
                onAbort = () => finish({resultType: 'cancelled', reason: 'client-gone'})
                signal.addEventListener('abort', onAbort, {once: true})
            }
            entries.set(askId, {state: 'open', kind, schema, requestState, answeredBy: '', finish})
        })
    }

    /**
     * @description 通道投递口（dispatcher 经 takeAnswerHandle 调到这里）
     * @param {Object} payload {askId, responses, answeredBy, requestState}
     * @returns {{accepted:Boolean, reason?:String, notice?:String}} 结果
     */
    function deliver(payload = {}) {
        const ackBase = {requestId: String(payload?.askId || ''), answerCode: String(payload?.answerCode || '')}
        const e = entries.get(String(payload?.askId || ''))
        if (!e) {
            stats.rejected++
            emitAckNow({...ackBase, accepted: false, code: 'no-such-request'})
            return {accepted: false, reason: 'no-such-request'}
        }
        const adm = decideAnswerAdmission({
            kind: e.kind,
            answerer: String(payload?.answeredBy || ''),
            initiator,
            participants: [],
            alreadyAnsweredBy: e.state === 'answered' ? e.answeredBy : '',
        })
        if (!adm.admit) {
            stats.rejected++
            emitAckNow({...ackBase, accepted: false, code: adm.reason})
            return {accepted: false, reason: adm.reason, notice: adm.notice}
        }
        /** requestState 逐字比对：两端都是服务端签发的串，相等即同一道题——askId 可能被抄错门牌 */
        if (String(payload?.requestState || '') !== e.requestState) {
            stats.rejected++
            emitAckNow({...ackBase, accepted: false, code: 'state-mismatch'})
            return {accepted: false, reason: 'state-mismatch'}
        }
        const v = validateAnswerPayload({
            inputResponses: payload?.responses,
            requestState: e.requestState,
            schema: e.schema,
            secret,
        })
        if (!v.ok) {
            stats.rejected++
            emitAckNow({...ackBase, accepted: false, code: 'bad-responses', notice: v.error})
            return {accepted: false, reason: 'bad-responses', notice: v.error}
        }
        e.state = 'answered'
        e.answeredBy = String(payload.answeredBy || '')
        e.finish({resultType: 'complete', responses: v.value.responses, answeredBy: e.answeredBy})
        emitAckNow({...ackBase, accepted: true, code: 'ok'})
        if (logger?.info) logger.info(`ask_user 已获答复 askId=${payload.askId} by=${e.answeredBy}（run=${runCode}）`)
        return {accepted: true}
    }

    return {runCode, register, deliver, stats, ackSnapshot: () => ackLog.map((x) => ({...x}))}
}

/**
 * @description 执行一次 ask_user：出题校验 ⇒ 密封续体 ⇒ SSE 发 await_input ⇒ 挂起等终局
 * @param {Object} params {toolCall, router, secret, askConfig, streamEvent, signal, checkpointSeq}
 * @returns {Promise<Object>} OpenAI tool 消息体（content 是 MRTR complete/cancelled 形状）
 *
 * 出题不合规（D28 凭据、空问、超长）⇒ 错误**回给模型**让它修题重问——与 update_plan
 * "静默修正是最阴的失效"同一条家规；但错误文案不许泄出密钥/签名细节（模型上下文是展示面）。
 */
export async function awaitAskUser({toolCall, router, secret, askConfig = {}, streamEvent, signal, checkpointSeq = 0} = {}) {
    const wrap = (obj) => ({tool_call_id: toolCall?.id, role: 'tool', content: JSON.stringify(obj)})
    if (!secret) {
        return wrap({resultType: 'cancelled', reason: 'no-signing-secret', error: '服务端未配置答复签名密钥，ask_user 不可用'})
    }
    let args = {}
    try {
        args = JSON.parse(toolCall?.function?.arguments || '{}')
    } catch {
        return wrap({success: false, error: 'ask_user 的参数不是合法 JSON，请修正后重试'})
    }
    const v = validateInputRequests(args.inputRequests, {})
    if (!v.ok) {
        return wrap({success: false, error: `出题被拒：${v.error}`})
    }
    const kind = args.kind === 'approval' ? 'approval' : 'question'
    let requestState = ''
    let payload = null
    try {
        requestState = sealRequestState({runCode: router.runCode, askId: String(toolCall?.id || ''), kind}, {secret})
        payload = buildAwaitInputPayload({inputRequests: v.value, requestState, checkpointSeq})
    } catch (e) {
        return wrap({success: false, error: `出题被拒：${String(e?.message || e).slice(0, 160)}`})
    }
    if (streamEvent) {
        try {
            streamEvent('await_input', {...payload, messageCode: router.runCode})
        } catch { /* 事件投递失败不反噬挂起：账在 router，前端从 /resume 也能补看 */ }
    }
    const outcome = await router.register({
        askId: String(toolCall?.id || ''),
        kind,
        schema: mergeFormSchema(v.value),
        requestState,
        timeoutMs: Number(askConfig.askTimeoutMs) || DEFAULT_TIMEOUT_MS,
        signal,
    })
    if (outcome.resultType === 'complete') {
        return wrap({resultType: 'complete', inputResponses: outcome.responses, answeredBy: outcome.answeredBy})
    }
    return wrap({resultType: 'cancelled', reason: outcome.reason})
}

export default {ASK_TOOL_NAME, buildAskTools, isAskTool, askToolEnabled, createAnswerRouter, awaitAskUser, answerSecret}
