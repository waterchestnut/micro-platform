/**
 * @fileOverview MRTR 交互挂起的纯判据（D28/D37；PR-E 首块，接线在装配批）
 * @module services/core/session/mrtrPayload
 * @description
 * `await_input` 载荷采用 MCP MRTR 形状（D28，"协议对齐不自己发明"）：
 * `{resultType:'input_required', inputRequests, requestState:<密封续体>, checkpointSeq}`；
 * `/answer` 原样回传 `{inputResponses, requestState}`（§8.1）。本件管四段契约：
 *   1. validateInputRequests：出题侧形状 + **D28 凭据禁令**（form 模式里出现疑似凭据字段 ⇒ 拒，必须走 url）；
 *   2. sealRequestState / openRequestState：续体防篡改（signedBlob 共享底座——算法只允许一份）；
 *   3. validateAnswerPayload：答题侧（未知键拒——"原样回显"不许变成"随便塞"；required 覆盖；浅类型就地校）；
 *   4. decideAnswerAdmission：谁能答（§2F line 548 已定的先到先得；审批角色待裁 §2F.4 → 保守到只有发起人）。
 *
 * 刻意不做：ask_user 工具与 run 状态机接线（要活 run 上下文）；续体**一次性**消费
 * （需 runRegistry 配合，装配批做——这里 open 只验真伪与新鲜度，不记账）。
 */

import {makeSignedBlob, readSignedBlob} from '../../../tools/signedBlob.js'

/** D37：MRTR resultType 与 A2A TaskState 的对应里，本件只涉及这两个值 */
export const MRTR_RESULT_TYPE = 'input_required'
export const MRTR_MODES = ['form', 'url']

/** D28 凭据字段判据：名字命中或 format=password 都不许进 form（照抄 MCP 安全约束，方向是拒不是纠） */
const CREDENTIAL_FIELD_RE = /(password|passwd|secret|token|apikey|api_key|accesskey|access_key|credential)/i

/**
 * @description 出题侧校验（await_input 的 inputRequests）
 * @param {Object[]} requests MRTR inputRequests 数组
 * @param {Object} [opts] {maxRequests, maxMsgChars}
 * @returns {{ok:Boolean, error?:String, value?:Object[]}} 结果
 */
export function validateInputRequests(requests = [], opts = {}) {
    const {maxRequests = 8, maxMsgChars = 4000} = opts
    if (!Array.isArray(requests) || requests.length === 0) {
        return {ok: false, error: 'inputRequests 需为非空数组（一次挂起至少要问一件事）'}
    }
    if (requests.length > maxRequests) {
        return {ok: false, error: `一次挂起最多 ${maxRequests} 个问题，当前 ${requests.length}（问题堆多了人是答不过来的）`}
    }
    const value = []
    for (const [i, rq] of requests.entries()) {
        const label = `inputRequests[${i}]`
        const mode = rq?.mode === undefined || rq?.mode === null ? 'form' : String(rq.mode)
        if (!MRTR_MODES.includes(mode)) return {ok: false, error: `${label}.mode=${JSON.stringify(rq?.mode)} 不在 ${MRTR_MODES.join('|')}`}
        const message = String(rq?.message ?? '').trim()
        if (!message) return {ok: false, error: `${label}.message 不能为空（要问什么得写清楚）`}
        if (message.length > maxMsgChars) return {ok: false, error: `${label}.message 超过 ${maxMsgChars} 字符`}
        if (mode === 'url') {
            const url = String(rq?.url ?? '').trim()
            if (!/^https?:\/\//i.test(url)) return {ok: false, error: `${label} url 模式必须给 http(s) 链接（收到 ${JSON.stringify(rq?.url ?? '')}）`}
            value.push({mode: 'url', message, url})
            continue
        }
        const schema = rq?.requestedSchema
        const props = schema && typeof schema.properties === 'object' && schema.properties !== null ? schema.properties : null
        if (!props || !Object.keys(props).length) {
            return {ok: false, error: `${label} form 模式必须带 requestedSchema.properties（没有字段要填就别用 form）`}
        }
        const credFields = Object.keys(props).filter((k) => CREDENTIAL_FIELD_RE.test(k) || String(props[k]?.format || '').toLowerCase() === 'password')
        if (credFields.length) {
            return {ok: false, error: `${label} 凭据类字段 ${credFields.join(', ')} 禁用 form 模式（D28：答案会进模型上下文，必须走 url 模式）`}
        }
        value.push({mode: 'form', message, requestedSchema: schema})
    }
    return {ok: true, value}
}

/**
 * @description 密封 checkpoint 续体（requestState 的生成侧）
 * @param {Object} state 续体内含（如 {checkpointCode, checkpointSeq, runCode}——形状由装配批定，本件不猜）
 * @param {Object} params {secret, now}
 * @returns {String} 密封串
 */
export function sealRequestState(state = {}, {secret, now = Date.now()} = {}) {
    if (!secret) throw new Error('sealRequestState 需要签名密钥')
    return makeSignedBlob(secret, {...state, iat: now})
}

/**
 * @description 解封校验（不记账——一次性消费在装配批）
 * @param {String} sealed 密封串
 * @param {Object} params {secret, now, maxAgeMs}
 *   maxAgeMs 默认 0=不限龄：**人的作答时长不可控**，短 TTL 会把"思考半小时"的正常用户挡在门外；
 *   新鲜度收紧的方向留给装配批（如 run 结束即作废 + 一次性），不在判据层偷加。
 * @returns {{ok:Boolean, value?:Object, error?:String}} 结果
 */
export function openRequestState(sealed, {secret, now = Date.now(), maxAgeMs = 0} = {}) {
    const r = readSignedBlob(secret, sealed, {now, maxAgeMs})
    if (!r.ok) return {ok: false, error: `requestState 校验失败：${r.reason}`}
    return {ok: true, value: r.value}
}

/**
 * @description await_input 事件载荷组装（§8 line 716 的形状；字段顺序不参与判断）
 * @param {Object} params {inputRequests(已验证), requestState(已密封), checkpointSeq}
 * @returns {Object} payload
 */
export function buildAwaitInputPayload({inputRequests, requestState, checkpointSeq} = {}) {
    const seq = Number(checkpointSeq)
    if (!Number.isInteger(seq) || seq < 0) throw new Error('checkpointSeq 必须是非负整数（断点号都给不出就谈不上续跑）')
    if (!requestState) throw new Error('缺 requestState：await_input 无状态可回显，/answer 无从回传')
    return {resultType: MRTR_RESULT_TYPE, inputRequests, requestState, checkpointSeq: seq}
}

/**
 * @description 答题侧入参校验（/answer 的 inputResponses + 密封续体）
 * @param {Object} params {inputResponses, requestState, schema(该 request 的 requestedSchema), secret, now, maxAgeMs}
 * @returns {{ok:Boolean, error?:String, value?:{responses:Object, state:Object}}} 结果
 */
export function validateAnswerPayload({inputResponses, requestState, schema, secret, now = Date.now(), maxAgeMs = 0} = {}) {
    const opened = openRequestState(requestState, {secret, now, maxAgeMs})
    if (!opened.ok) return opened
    if (inputResponses === null || typeof inputResponses !== 'object' || Array.isArray(inputResponses)) {
        return {ok: false, error: 'inputResponses 需为对象'}
    }
    const props = schema && typeof schema.properties === 'object' && schema.properties !== null ? schema.properties : null
    if (props) {
        const unknown = Object.keys(inputResponses).filter((k) => !(k in props))
        if (unknown.length) {
            // "原样回显"不是"随便塞"：续体上下文里冒出来的键会在下一轮 prompt 里以假乱真
            return {ok: false, error: `inputResponses 含问题之外的键：${unknown.join(', ')}`}
        }
        const required = Array.isArray(schema.required) ? schema.required : []
        const missing = required.filter((k) => !(k in inputResponses))
        if (missing.length) return {ok: false, error: `缺必答字段：${missing.join(', ')}`}
        for (const [k, v] of Object.entries(inputResponses)) {
            const t = props[k]?.type
            const actual = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v
            if (t && t !== actual) return {ok: false, error: `字段 ${k} 期望 ${t}，收到 ${actual}`}
            if (t === 'string' && Array.isArray(props[k]?.enum) && !props[k].enum.includes(v)) {
                return {ok: false, error: `字段 ${k} 的值不在候选内（${props[k].enum.join('|')}）`}
            }
        }
    }
    return {ok: true, value: {responses: inputResponses, state: opened.value}}
}

/**
 * @description 谁能答（§2F line 548：先到先得；其余人收"已被 X 回答"）
 * @param {Object} params {kind:'question'|'approval', answerer, initiator, participants, alreadyAnsweredBy}
 * @returns {{admit:Boolean, notice?:String, reason?:String}} 结果
 *
 * approval 保守到**只认发起人**：审批角色细则还挂在 §2F.4/开放问题表等产品裁定（line 1368），
 * 在裁定前"能点批准的人越少越安全"；裁定后由装配批注入角色表，不返工本判据。
 */
export function decideAnswerAdmission({kind = 'question', answerer = '', initiator = '', participants = [], alreadyAnsweredBy = ''} = {}) {
    if (!answerer) return {admit: false, reason: 'no-answerer'}
    if (alreadyAnsweredBy) {
        return {admit: false, reason: 'already-answered', notice: `已被 ${alreadyAnsweredBy} 回答，你的输入不再采用`}
    }
    if (kind === 'approval') {
        if (answerer !== initiator) {
            return {admit: false, reason: 'approval-initiator-only', notice: '审批类问题只接受发起人本人确认（角色细则待 §2F.4 裁定）'}
        }
        return {admit: true}
    }
    const pool = new Set([initiator, ...(Array.isArray(participants) ? participants : [])].filter(Boolean))
    if (pool.size && !pool.has(answerer)) {
        return {admit: false, reason: 'not-participant'}
    }
    return {admit: true}
}

export default {MRTR_RESULT_TYPE, MRTR_MODES, validateInputRequests, sealRequestState, openRequestState, buildAwaitInputPayload, validateAnswerPayload, decideAnswerAdmission}
