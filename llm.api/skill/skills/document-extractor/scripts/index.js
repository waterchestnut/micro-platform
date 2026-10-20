/**
 * @fileOverview Document Extractor Skill 执行脚本（自包含版）
 * @module skill/skills/document-extractor/scripts
 * @description 这个脚本会被打包进 OpenSandbox 执行，因此**不得 import llm.api 内部模块**
 * （旧版 `import {pdf2Text,...} from '../../../../grpc/clients/extractor.js'` 会把 gRPC 客户端、
 * .proto、node_modules、llm.config 全拖进沙箱，那就不叫自包含）。
 *
 * 需要的能力改为**回连宿主 HTTP 接口** `/core/skill-host/extract`，凭据是每次执行签发的短期
 * 能力 token，通过环境变量注入：
 *   SKILL_HOST_BASE   宿主基地址（集群内 Service）
 *   SKILL_CAP_TOKEN   能力 token（只含本次执行需要的能力，短期有效）
 *
 * 只用 Node 内置能力（fetch 在 Node 18+ 是全局），由 tools/skillBundle.js 的
 * checkSelfContained 静态把关；违规 import 会在打包前就被拒。
 */

const HOST = (process.env.SKILL_HOST_BASE || '').replace(/\/+$/, '')
const TOKEN = process.env.SKILL_CAP_TOKEN || ''
/** 宿主回连超时：比沙箱整体超时短，避免挂着不动 */
const CALL_TIMEOUT_MS = Number(process.env.SKILL_HOST_TIMEOUT_MS) || 60000

const TYPES = {pdf: 'pdf', doc: 'word', docx: 'word', xls: 'excel', xlsx: 'excel', htm: 'html', html: 'html'}

function guessType(url) {
    const clean = String(url).split('?')[0].split('#')[0].toLowerCase()
    const ext = clean.slice(clean.lastIndexOf('.') + 1)
    return TYPES[ext] || ''
}

async function callHost(path, body) {
    if (!HOST) {
        throw new Error('缺少 SKILL_HOST_BASE：沙箱内无法回连宿主能力接口')
    }
    if (!TOKEN) {
        throw new Error('缺少 SKILL_CAP_TOKEN：本次执行没有被授予宿主能力')
    }
    const res = await fetch(`${HOST}${path}`, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${TOKEN}`},
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
        let msg = text.slice(0, 200)
        try {
            msg = JSON.parse(text)?.msg || JSON.parse(text)?.error || msg
        } catch { /* 非 JSON 响应保留原文片段 */ }
        throw new Error(`宿主能力接口 ${path} 返回 ${res.status}：${msg}`)
    }
    return JSON.parse(text || '{}')
}

/**
 * @description 统一入口：按 url 解析文档
 * @param {String} fileType pdf|word|excel|html
 * @param {Object} params {url, language}
 * @returns {Promise<Object>} 解析结果
 */
async function extractByType(fileType, params) {
    const url = params.url || params.fileUrl
    if (!url) {
        throw new Error('缺少参数 url')
    }
    const ret = await callHost('/core/skill-host/extract', {
        url,
        fileType,
        language: params.language || '',
    })
    return {
        fileType,
        chars: ret.chars ?? String(ret.text || '').length,
        text: String(ret.text || ''),
        source: url,
    }
}

export async function extractFromPdf(params) {
    return await extractByType('pdf', params)
}

export async function extractFromWord(params) {
    return await extractByType('word', params)
}

export async function extractFromExcel(params) {
    return await extractByType('excel', params)
}

export async function extractFromHtml(params) {
    return await extractByType('html', params)
}

/**
 * @description 按扩展名自动选类型解析
 * @param {Object} params {url, language}
 * @returns {Promise<Object>} 解析结果
 */
export async function smartExtract(params) {
    const type = guessType(params.url || params.fileUrl || '')
    if (!type) {
        throw new Error(`无法从地址判断文件类型，请显式指定 fileType（${Object.values(TYPES).join('/')}）`)
    }
    return await extractByType(type, params)
}

/**
 * @description 统一命令入口（沙箱 harness 优先调用它）
 * @param {String} commandName 命令名
 * @param {Object} parameters 参数
 * @returns {Promise<Object>} 执行结果
 */
export async function executeCommand(commandName, parameters = {}) {
    const handlers = {extractFromPdf, extractFromWord, extractFromExcel, extractFromHtml, smartExtract}
    const fn = handlers[commandName]
    if (!fn) {
        throw new Error(`未知命令: ${commandName}（可用：${Object.keys(handlers).join(', ')}）`)
    }
    return await fn(parameters)
}
