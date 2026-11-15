/**
 * @fileOverview 签名数据块（b64url(JSON).HMAC）——服务端自签自验的共享底座
 * @module tools/signedBlob
 * @description
 * 从 `services/sandbox/capability.js` 抽出的同一套原语：抽的原因不是复用优雅，而是**算法不许有第二份实现**——
 * 本仓已三次记录"两处各写各的后来漂移"（ajv 选项、不可见表、协议默认值）。签名这种安全原语漂移的后果
 * 是"一处校得另一处校不得"，所以从这里开始只允许一份。
 *
 * 语义边界：本模块只管"防篡改的载荷"（格式/签名/解析/新鲜度），**不管载荷含义**——
 * 能力白名单归 capability，续体一次性归 PR-E 装配侧，各自的过期策略也各自传。
 * 校验一律 timingSafeEqual（计时侧信道，沿用 capability 的既有纪律）。
 */
import crypto from 'node:crypto'

export const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/**
 * @description HMAC-SHA256 签名（b64url 输出）
 * @param {String} secret 密钥
 * @param {String} body 待签正文（b64url 编码后的载荷串）
 * @returns {String} 签名
 */
export function signBlob(secret, body) {
    return b64u(crypto.createHmac('sha256', String(secret)).update(body).digest())
}

/**
 * @description 造签名数据块：b64url(JSON).签名
 * @param {String} secret 密钥
 * @param {Object} obj 载荷（调用方负责塞 iat 等时间字段——新鲜度策略不在本层）
 * @returns {String} token
 */
export function makeSignedBlob(secret, obj = {}) {
    if (!secret) throw new Error('签名密钥不能为空')
    const body = b64u(Buffer.from(JSON.stringify(obj), 'utf8'))
    return `${body}.${signBlob(secret, body)}`
}

/**
 * @description 拆签名数据块：格式 → 签名（timingSafeEqual）→ JSON → 新鲜度（可选）
 * @param {String} secret 密钥
 * @param {String} token 待验串（容忍 "Bearer " 前缀由调用方自己先剥——capability 的 HTTP 头语义不外溢）
 * @param {Object} [opts] {now, maxAgeMs}：maxAgeMs>0 时要求载荷带 iat 且未超龄
 * @returns {{ok:true, value:Object}|{ok:false, reason:String}} 结果
 */
export function readSignedBlob(secret, token, opts = {}) {
    const {now = Date.now(), maxAgeMs = 0} = opts
    if (!secret) return {ok: false, reason: '服务端未配置签名密钥'}
    const raw = String(token || '').trim()
    const dot = raw.lastIndexOf('.')
    if (dot <= 0 || dot === raw.length - 1) return {ok: false, reason: '格式不对（应为 body.signature）'}
    const body = raw.slice(0, dot)
    const sig = raw.slice(dot + 1)
    const expect = signBlob(secret, body)
    const a = Buffer.from(sig)
    const b = Buffer.from(expect)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return {ok: false, reason: '签名不匹配，内容被篡改或密钥已更换'}
    }
    let value = null
    try {
        value = JSON.parse(unb64u(body).toString('utf8'))
    } catch {
        return {ok: false, reason: '载荷不是合法 JSON'}
    }
    if (maxAgeMs > 0) {
        if (!Number.isFinite(Number(value?.iat))) return {ok: false, reason: '载荷缺少签发时间（iat），无法判新鲜度'}
        if (now - Number(value.iat) > maxAgeMs) return {ok: false, reason: '已超时'}
    }
    return {ok: true, value}
}

export default {b64u, unb64u, signBlob, makeSignedBlob, readSignedBlob}
