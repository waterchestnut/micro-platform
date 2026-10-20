/**
 * @fileOverview 沙箱回连宿主所用能力凭据（capability token）
 * @module services/sandbox/capability
 * @description 自包含的 skill 脚本不能再 import llm.api 内部模块，它需要的外部能力
 * （如文档解析）改由**反向调用宿主 HTTP 接口**获得。为此每次执行签发一枚短期 token，
 * 绑死"哪个沙箱、哪个会话、允许哪些能力、什么时候过期"，避免把服务账号或长期密钥放进沙箱：
 * 沙箱里跑的是模型可影响的代码，任何长效凭据进去等于泄漏。
 *
 * 载荷明文 + HMAC 签名（不加密：里面没有秘密，但必须防篡改）；
 * 校验侧一律用 timingSafeEqual，避免计时侧信道。
 */
import crypto from 'node:crypto'

/** 当前支持的能力白名单；加新能力要同时在这里登记，token 才不会越界 */
export const CAPABILITIES = ['extract']

const DEFAULT_TTL_MS = 15 * 60 * 1000

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function sign(secret, body) {
    return b64u(crypto.createHmac('sha256', String(secret)).update(body).digest())
}

/**
 * @description 签发能力 token
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.secret 服务端签名密钥（取 llm.config.cookieSecret）
 * @param {String} params.sandboxId 绑定的沙箱
 * @param {String} [params.conversationCode] 绑定会话
 * @param {String} [params.userCode] 归属用户
 * @param {String[]} params.caps 允许的能力
 * @param {Number} [params.ttlMs] 有效期
 * @param {Number} [params.now] 当前时间戳（便于测试）
 * @returns {Object} {token, expiresAt, caps}
 */
export function issueCapabilityToken(params = {}) {
    const {secret, sandboxId, conversationCode = '', userCode = '', ttlMs = DEFAULT_TTL_MS, now = Date.now()} = params
    let caps = params.caps || []
    if (!secret) {
        throw new Error('签发能力 token 需要签名密钥（cookieSecret 未配置）')
    }
    if (!sandboxId) {
        throw new Error('签发能力 token 需要 sandboxId')
    }
    caps = [...new Set(caps.map(String))]
    const unknown = caps.filter(c => !CAPABILITIES.includes(c))
    if (unknown.length) {
        throw new Error(`未登记的能力: ${unknown.join(', ')}（白名单：${CAPABILITIES.join(', ')}）`)
    }
    if (!caps.length) {
        throw new Error('能力 token 至少要带一个能力，否则签了也没用')
    }
    const exp = Number(now) + Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS)
    const body = b64u(JSON.stringify({sid: sandboxId, conv: conversationCode, usr: userCode, caps, exp}))
    return {token: `${body}.${sign(secret, body)}`, expiresAt: exp, caps}
}

/**
 * @description 校验能力 token
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.secret 签名密钥
 * @param {String} params.token 待校验 token（支持带 "Bearer " 前缀）
 * @param {String} [params.sandboxId] 必须匹配的沙箱
 * @param {String} params.cap 本次要访问的能力
 * @param {Number} [params.now] 当前时间戳
 * @returns {Object} {ok, reason, payload}
 */
export function verifyCapabilityToken(params = {}) {
    const {secret, cap, sandboxId, now = Date.now()} = params
    const raw = String(params.token || '').replace(/^Bearer\s+/i, '').trim()
    const fail = (reason) => ({ok: false, reason})
    if (!secret) {
        return fail('服务端未配置签名密钥')
    }
    const dot = raw.lastIndexOf('.')
    if (dot <= 0 || dot === raw.length - 1) {
        return fail('token 格式不对（应为 body.signature）')
    }
    const body = raw.slice(0, dot)
    const sig = raw.slice(dot + 1)
    const expect = sign(secret, body)
    const a = Buffer.from(sig)
    const b = Buffer.from(expect)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return fail('签名不匹配，token 被篡改或密钥已更换')
    }
    let payload = null
    try {
        payload = JSON.parse(unb64u(body).toString('utf8'))
    } catch {
        return fail('token 载荷不是合法 JSON')
    }
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < Number(now)) {
        return fail('token 已过期，请重新发起该次工具调用')
    }
    if (sandboxId && payload.sid !== sandboxId) {
        return fail('token 与当前沙箱不匹配')
    }
    if (cap && !(Array.isArray(payload.caps) && payload.caps.includes(cap))) {
        return fail(`token 未包含 ${cap} 能力`)
    }
    return {ok: true, payload}
}

/**
 * @description 取签名密钥（集中一处，避免各处自己读配置）
 * @author xianyang
 * @returns {String} 密钥，未配置时返回空串
 */
export function capabilitySecret() {
    return (typeof llm !== 'undefined' ? llm.config?.cookieSecret : '') || ''
}

export default {CAPABILITIES, issueCapabilityToken, verifyCapabilityToken, capabilitySecret}
