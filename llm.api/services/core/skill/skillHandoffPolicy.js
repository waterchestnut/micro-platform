/**
 * @fileOverview 写面 handoff 型的一次性确认判据（纯函数族，无 IO）
 * @module services/core/skill/skillHandoffPolicy
 * @description
 * feature-map §4B「复杂写 = 一次性确认 token + 确认时才落库」的**判据层**，与
 * `skillWriteIdempotency.js` 同族（纯表、穷举可测、IO 归接线层 `skillHandoff.js`）。
 *
 * 三件事，全部无副作用、可注入 secret/now 逐项断言：
 * 1. `buildHandoffPayload` —— 确认 token 的载荷形状（绑 journalKey+userCode+paramsHash+jti+时效）；
 * 2. `verifyHandoffToken` —— 拆签后的语义校验（签名/新鲜度由 signedBlob 兜，这里校载荷完整性
 *    与"确认人=发起人"——handoff 深链可能被转发，token 有效 ≠ 谁都能兑）；
 * 3. `decideRedeem` —— 兑换终判，复合"token 判定 × jti 一次性 × decideConfirm（参数冻结）"。
 *
 * paramsHash 用 md5（与 skillWriteJournal.paramsHash/grpcSkill.skillMDHash 同口径=变更检测非对抗），
 * 且对**键序稳定**（canonical stringify），否则同参数因序列化顺序不同而哈希漂移、误拒合法确认。
 */
import crypto from 'node:crypto'
import {readSignedBlob} from '../../../tools/signedBlob.js'

/** token 校验/兑换的理由全词表（封闭集，新理由必须进测试；对齐 GATE_REASONS 的做法） */
export const HANDOFF_REASONS = [
    'ok', 'no-secret', 'bad-format', 'bad-signature', 'no-iat', 'expired',
    'bad-payload', 'missing-claim', 'user-mismatch', 'missing-jti',
    'replayed', 'not-proposed', 'param-mismatch',
]

/** signedBlob 的中文失败串 → 本模块枚举理由（归一在判据层做，接线层不各自猜）。
 *  判别用各自**唯一**子串：'服务端未配置签名密钥' 与 '签名不匹配…密钥已更换' 都含"密钥/签名"，
 *  故先比"未配置"（no-secret 独有）、再比"不匹配"（bad-signature 独有），顺序敏感。 */
function normalizeBlobReason(r) {
    const s = String(r || '')
    if (s.includes('未配置')) return 'no-secret'
    if (s.includes('格式')) return 'bad-format'
    if (s.includes('不匹配')) return 'bad-signature'
    if (s.includes('iat')) return 'no-iat'
    if (s.includes('超时')) return 'expired'
    return 'bad-payload'
}

/** 默认 token 时效（毫秒）——手快点确认够用，又不至于让深链长期有效 */
export const DEFAULT_HANDOFF_TTL_MS = 10 * 60 * 1000

/**
 * @description 稳定序列化（键排序），保证同一参数对象哈希唯一
 * @param {*} v
 * @returns {String}
 */
export function canonicalJson(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
    if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
    const keys = Object.keys(v).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}'
}

/**
 * @description 参数快照哈希（md5，键序稳定）
 * @param {Object} params
 * @returns {String}
 */
export function hashParams(params) {
    return crypto.createHash('md5').update(canonicalJson(params ?? {}), 'utf8').digest('hex')
}

/**
 * @description 造确认 token 的载荷（接线层再交 signedBlob 签名）
 * @param {Object} p {journalKey, userCode, paramsHash, jti, now, ttlMs}
 * @returns {Object} {journalKey, userCode, paramsHash, jti, iat, exp}
 */
export function buildHandoffPayload({journalKey = '', userCode = '', paramsHash = '', jti = '', now = Date.now(), ttlMs = DEFAULT_HANDOFF_TTL_MS} = {}) {
    return {journalKey, userCode, paramsHash, jti, iat: now, exp: now + ttlMs}
}

/**
 * @description token 全校验（拆签 + 新鲜度 + 语义），单入口可注入 secret/now 纯测
 * @param {Object} p {secret, token, callerUserCode, now, ttlMs}
 * @returns {{ok:boolean, reason:String, value?:Object}}
 */
export function verifyHandoffToken({secret = '', token = '', callerUserCode = '', now = Date.now(), ttlMs = DEFAULT_HANDOFF_TTL_MS} = {}) {
    const r = readSignedBlob(secret, token, {now, maxAgeMs: ttlMs})
    if (!r.ok) return {ok: false, reason: normalizeBlobReason(r.reason)}
    return verifyHandoffClaim({value: r.value, callerUserCode})
}

/**
 * @description 校已拆签的 handoff 载荷的**语义**（签名/新鲜度由 signedBlob 负责，此处校主张与归属）
 * @param {Object} p
 * @param {Object} p.value readSignedBlob 拆出的载荷
 * @param {String} p.callerUserCode 当前调用者（端点从鉴权身份取，非模型/参数自报）
 * @returns {{ok:boolean, reason:String, value?:Object}}
 */
export function verifyHandoffClaim({value = null, callerUserCode = ''} = {}) {
    if (!value || typeof value !== 'object') return {ok: false, reason: 'bad-payload'}
    if (!value.journalKey) return {ok: false, reason: 'missing-claim'}
    if (!value.jti) return {ok: false, reason: 'missing-jti'}
    // 转发防御：token 有效不代表谁都能兑——必须确认人=发起人
    if (!callerUserCode || value.userCode !== callerUserCode) return {ok: false, reason: 'user-mismatch'}
    return {ok: true, reason: 'ok', value}
}

/**
 * @description 兑换终判（纯表）：token 语义判定 × jti 一次性 × 参数冻结确认
 * @param {Object} p
 * @param {{ok:boolean, reason:String, value?:Object}} p.claimVerdict verifyHandoffClaim 的结果
 * @param {Boolean} p.alreadyConsumed jti 是否已被消费（接线层 setIfAbsent 取反得到）
 * @param {Object|null} p.existing journal 账行（lookup 结果）
 * @returns {{action:'proceed'|'refuse', reason:String, useParams?:String, journalKey?:String}}
 *  proceed 只回账里 paramSnapshot——执行侧拿什么跑什么，模型/前端本轮再生的参数不作数（B0-2）。
 */
export function decideRedeem({claimVerdict = {ok: false, reason: 'bad-payload'}, alreadyConsumed = false, existing = null} = {}) {
    if (!claimVerdict.ok) return {action: 'refuse', reason: claimVerdict.reason}
    const payload = claimVerdict.value
    if (alreadyConsumed) return {action: 'refuse', reason: 'replayed'}
    if (!existing || existing.status !== 'proposed') return {action: 'refuse', reason: 'not-proposed'}
    const stored = typeof existing.paramsHash === 'string' ? existing.paramsHash.trim() : ''
    if (!stored || !payload.paramsHash || stored !== payload.paramsHash) return {action: 'refuse', reason: 'param-mismatch'}
    return {action: 'proceed', reason: 'ok', useParams: existing.paramSnapshot ?? '', journalKey: payload.journalKey}
}

export default {HANDOFF_REASONS, DEFAULT_HANDOFF_TTL_MS, canonicalJson, hashParams, buildHandoffPayload, verifyHandoffClaim, decideRedeem}
