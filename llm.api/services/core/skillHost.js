/**
 * @fileOverview 供沙箱回连使用的宿主能力接口
 * @module services/core/skillHost
 * @description 自包含 skill 在沙箱里跑时不能 import 宿主模块，需要的外部能力（这里是文档解析）
 * 通过本接口反向调用。鉴权用**一次性的能力 token**（services/sandbox/capability.js 签发），
 * 而不是服务账号或长期密钥：沙箱里执行的代码可能被模型影响，任何长效凭据放进沙箱都是泄漏面。
 *
 * 三条边界：
 * 1. token 校验不过一律 401，且**不因请求来自内网就放行**——内网也有横向移动的可能；
 * 2. 单次请求体有硬上限，且**只接受 url 或 contentBase64 之一**，不接受任意文件路径（防读宿主盘）；
 * 3. 只做白名单里的四种格式转换，不代理任意 HTTP 请求（否则沙箱就借道出了网）。
 */
import {pdf2Text, word2Text, excel2Text, html2Text} from '../../grpc/clients/extractor.js'
import {verifyCapabilityToken, capabilitySecret, CAPABILITIES} from '../sandbox/capability.js'

const config = llm.config
const logger = llm.logger

/** 允许的文件类型 → 对应的解析函数 */
const EXTRACTORS = {pdf: pdf2Text, word: word2Text, excel: excel2Text, html: html2Text}

/** 单次处理的字节上限（base64 后约 1.37 倍） */
const MAX_BYTES = () => Number(config.skillHost?.maxBytes) || 20 * 1024 * 1024

/**
 * @description 从请求头取能力 token 并校验
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.authorization `Bearer <token>`
 * @param {String} params.cap 需要的能力
 * @param {String} [params.sandboxId] 期望绑定的沙箱
 * @returns {Object} {ok, reason, payload}
 */
export function authenticate({authorization, cap, sandboxId} = {}) {
    return verifyCapabilityToken({secret: capabilitySecret(), token: authorization, cap, sandboxId})
}

/**
 * @description 文档解析能力
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} [params.url] 文件地址（由宿主代为下载）
 * @param {String} [params.contentBase64] 文件内容 base64（与 url 二选一）
 * @param {String} params.fileType pdf|word|excel|html
 * @param {String} [params.language] 解析语言提示
 * @param {String} [params.sandboxId] 审计用
 * @returns {Promise<Object>} {text, chars, fileType}
 */
export async function extract(params = {}) {
    const {url, contentBase64, fileType, language, sandboxId} = params
    const fn = EXTRACTORS[String(fileType || '').toLowerCase()]
    if (!fn) {
        const err = new Error(`不支持的文件类型: ${String(fileType).slice(0, 20)}（可用：${Object.keys(EXTRACTORS).join(', ')}）`)
        err.statusCode = 400
        throw err
    }
    if (url && contentBase64) {
        const err = new Error('url 与 contentBase64 只能二选一')
        err.statusCode = 400
        throw err
    }
    let content = null
    if (contentBase64) {
        const b64 = String(contentBase64).replace(/^data:[^;]+;base64,/, '')
        if (b64.length * 0.75 > MAX_BYTES()) {
            const err = new Error(`内容超过单次上限 ${Math.round(MAX_BYTES() / 1024 / 1024)}MB`)
            err.statusCode = 413
            throw err
        }
        content = Buffer.from(b64, 'base64')
        if (!content.length) {
            const err = new Error('contentBase64 解出空内容')
            err.statusCode = 400
            throw err
        }
    } else if (url) {
        const fetched = await fetchFile(String(url))
        content = fetched
    } else {
        const err = new Error('需要 url 或 contentBase64')
        err.statusCode = 400
        throw err
    }
    const text = await fn(content, language || '')
    logger.info(`skill-host extract 完成 sandbox=${sandboxId || '-'} type=${fileType} chars=${String(text || '').length}`)
    return {text: String(text || ''), chars: String(text || '').length, fileType}
}

/**
 * @description 由宿主代为下载文件（沙箱不直接出网，减少 egress 面）
 * @author xianyang
 * @param {String} url 文件地址
 * @returns {Promise<Buffer>} 内容
 */
async function fetchFile(url) {
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        const err = new Error('url 不合法')
        err.statusCode = 400
        throw err
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        const err = new Error(`只允许 http/https，收到 ${parsed.protocol}`)
        err.statusCode = 400
        throw err
    }
    const timeoutMs = Number(config.skillHost?.fetchTimeoutMs) || 60000
    const res = await fetch(url, {signal: AbortSignal.timeout(timeoutMs), redirect: 'follow'})
    if (!res.ok) {
        const err = new Error(`宿主下载失败：${res.status}`)
        err.statusCode = 502
        throw err
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES()) {
        const err = new Error(`文件超过上限 ${Math.round(MAX_BYTES() / 1024 / 1024)}MB`)
        err.statusCode = 413
        throw err
    }
    return buf
}

export const availableCapabilities = CAPABILITIES
export default {authenticate, extract, availableCapabilities}
