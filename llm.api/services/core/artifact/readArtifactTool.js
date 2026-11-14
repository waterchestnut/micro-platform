/**
 * @fileOverview 下发给模型的 read_artifact 工具（PR-H2/D25：压缩≠丢信息的取回入口，纯件）
 * @module services/core/artifact/readArtifactTool
 * @description
 * §9.5 line 813 的配对件：产物经 save_artifact 入库后，**read_artifact(artifactCode, offset, limit) 跨轮持久**——
 * 上下文被压缩/翻轮之后，模型凭 artifactCode 把手重新读回正文，"摘要里留了名字但丢了内容"不再成立。
 *
 * 本模块是纯件（同 saveArtifactTool 纪律）：schema/参数校验/取回结果组装全离线可测；
 * IO 全注入（deps：账行查询 + doc.api 读字节）。
 *
 * 读法的一条实测边界（诚实）：doc.api 的 **Range 支持未实测**（探针只验证过整文件 GET 读回），
 * 所以生产读=整文件读回后**服务端切片**；为挡住"为读 2KB 拉 200MB"，
 * maxArtifactBytes 上限先行——超限拒读并说明原因，而不是默默吃带宽。Range 实测通过后可换实现，接口不变。
 *
 * 出错一律 success:false 回给模型（同 run_code/save_artifact），不抛断聊天循环。
 */

import {INTAKE_ERRORS} from './intakeErrors.js'

export const READ_ARTIFACT_TOOL_NAME = 'read_artifact'

/** 单次返回正文的默认/上限（字符）：产物页要进上下文，给太宽等于绕过裁剪体系 */
export const DEFAULT_LIMIT_CHARS = 8000
export const MAX_LIMIT_CHARS = 32000

/**
 * @description 构造 read_artifact 工具定义
 * @returns {Object[]} tools 数组片段
 */
export function buildReadArtifactTools() {
    return [{
        type: 'function',
        function: {
            name: READ_ARTIFACT_TOOL_NAME,
            description: [
                '按 artifactCode 分页读回此前经 save_artifact 入库的产物正文。',
                '上下文压缩或跨轮之后想找回原文就用它：offset 是字符偏移，limit 单次上限（默认 ' + DEFAULT_LIMIT_CHARS + '，最大 ' + MAX_LIMIT_CHARS + '）。',
                '返回里 totalChars/remainingChars 会告诉你还剩多少，翻完为止。',
            ].join(''),
            parameters: {
                type: 'object',
                properties: {
                    artifactCode: {type: 'string', description: 'save_artifact 返回的产物标识'},
                    offset: {type: 'number', description: '起始字符偏移（含），默认 0'},
                    limit: {type: 'number', description: `本次最多返回字符数（1..${MAX_LIMIT_CHARS}）`},
                },
                required: ['artifactCode'],
            },
        },
    }]
}

/**
 * @description 是否 read_artifact 工具
 * @param {String} toolName 工具名
 * @returns {Boolean} 是否是
 */
export function isReadArtifactTool(toolName) {
    return toolName === READ_ARTIFACT_TOOL_NAME
}

/**
 * @description 入参归一/校验（纯函数）
 * @param {Object} args 模型参数
 * @param {Object} [cfg] {maxLimitChars, defaultLimitChars}
 * @returns {{ok:Boolean, error?:String, value?:{artifactCode:String,offset:Number,limit:Number}}} 结果
 */
export function validateReadArgs(args = {}, cfg = {}) {
    const maxLimit = Number(cfg.maxLimitChars) || MAX_LIMIT_CHARS
    const artifactCode = String(args.artifactCode ?? '').trim()
    if (!artifactCode) {
        return {ok: false, error: 'artifactCode 不能为空（save_artifact 的返回值）'}
    }
    const offset = args.offset === undefined || args.offset === null ? 0 : Number(args.offset)
    if (!Number.isInteger(offset) || offset < 0) {
        return {ok: false, error: `offset 需为 ≥0 的整数，收到 ${JSON.stringify(args.offset)}`}
    }
    let limit = args.limit === undefined || args.limit === null ? (Number(cfg.defaultLimitChars) || DEFAULT_LIMIT_CHARS) : Number(args.limit)
    if (!Number.isInteger(limit) || limit < 1) {
        return {ok: false, error: `limit 需为 ≥1 的整数，收到 ${JSON.stringify(args.limit)}`}
    }
    // limit 超额是"多给了参数"不是"错到没法干活"——钳制即可，但必须回 warning？这里没带 warnings 通道，钳制进 value 由执行体回吐
    const clamped = limit > maxLimit
    if (clamped) limit = maxLimit
    return {ok: true, value: {artifactCode, offset, limit}, warnings: clamped ? [`limit 超过 ${maxLimit}，已钳制`] : []}
}

/**
 * @description 对整文件字节做**UTF-8 安全的字符切片**（offset/limit 按字符不按字节——截多字节字符中缝是"乱码页"的经典来源）
 * @param {Buffer|String} content 正文
 * @param {Number} offset 字符偏移
 * @param {Number} limit 字符上限
 * @returns {{text:String,totalChars:Number,remainingChars:Number,hasMore:Boolean}} 切片结果
 */
export function sliceArtifactText(content, offset = 0, limit = DEFAULT_LIMIT_CHARS) {
    const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content ?? '')
    const chars = [...text]   // 码点迭代：代理对不被劈开
    const totalChars = chars.length
    const page = chars.slice(offset, offset + limit).join('')
    const end = Math.min(offset + limit, totalChars)
    return {text: page, totalChars, remainingChars: Math.max(0, totalChars - end), hasMore: end < totalChars}
}

/**
 * @description 执行一次 read_artifact（deps 注入；全失败路径 success:false）
 * @param {Object} params 入参
 * @param {Object} params.toolCall 工具调用
 * @param {Object} [params.artifactConfig] {maxLimitChars, defaultLimitChars, maxArtifactBytes}
 * @param {Object} deps 注入
 * @param {Function} deps.findArtifact 按 artifactCode 查账行 ⇒ {state,integrity,fileCode,fileUrl,sizeBytes,sha256,name}|null
 * @param {Function} deps.fetchArtifactBytes (row) => Promise<Buffer> 整文件读（生产=doc.api download；Range 实测后可换分段实现）
 * @param {Function} [deps.isReferenced] 预留：可见性/引用校验钩子（接线刀决定语义，缺=不启用）
 * @returns {Promise<Object>} OpenAI tool 消息体
 */
export async function executeReadArtifactTool({toolCall, artifactConfig = {}, deps = {}} = {}) {
    const callId = toolCall?.id
    const wrap = (obj) => ({tool_call_id: callId, role: 'tool', content: JSON.stringify(obj)})
    let args = {}
    try {
        args = JSON.parse(toolCall?.function?.arguments || '{}')
    } catch {
        return wrap({success: false, error: '参数不是合法 JSON'})
    }
    const v = validateReadArgs(args, artifactConfig)
    if (!v.ok) {
        return wrap({success: false, error: v.error})
    }
    if (typeof deps.findArtifact !== 'function' || typeof deps.fetchArtifactBytes !== 'function') {
        return wrap({success: false, error: `${INTAKE_ERRORS.TOOL_WIRING_NOT_READY}：read_artifact 接线未就绪（缺 findArtifact/fetchArtifactBytes）`})
    }
    const {artifactCode, offset, limit} = v.value
    let row = null
    try {
        row = await deps.findArtifact(artifactCode)
    } catch (e) {
        return wrap({success: false, error: `查账失败：${String(e?.message || e).slice(0, 200)}`})
    }
    if (!row) {
        return wrap({success: false, error: `artifactCode 不存在：${artifactCode.slice(0, 80)}`})
    }
    // 只读"活着且给得出内容"的行：未 ready 的在途行、被对账标 broken/dangling 的行、已注销行都拒（理由如实给）
    if (row.status === -1) {
        return wrap({success: false, error: '产物已注销', data: {state: row.state}})
    }
    if (!['registered', 'ready'].includes(row.state)) {
        return wrap({success: false, error: `产物尚未入库完成（state=${row.state}），稍后可重试`, data: {state: row.state}})
    }
    if (row.integrity && row.integrity !== 'ok' && row.integrity !== 'unknown') {
        return wrap({success: false, error: `产物被对账标记为 ${row.integrity}，内容不可保证`, data: {state: row.state, integrity: row.integrity}})
    }
    const cap = Number(artifactConfig.maxArtifactBytes) || 16 * 1024 * 1024
    if (Number(row.sizeBytes) > cap) {
        // 整文件读模型下的诚实闸门：拒读并说明，而不是悄悄拉爆带宽
        return wrap({success: false, error: `产物 ${row.sizeBytes} 字节超过单次读上限 ${cap}（Range 分段读未实测，暂不整吞大文件）`, data: {sizeBytes: row.sizeBytes}})
    }
    let buf = null
    try {
        buf = await deps.fetchArtifactBytes(row)
    } catch (e) {
        return wrap({success: false, error: `读取内容失败：${String(e?.message || e).slice(0, 200)}`, data: {state: row.state}})
    }
    const page = sliceArtifactText(buf, offset, limit)
    if (offset >= page.totalChars && page.totalChars > 0) {
        return wrap({success: false, error: `offset ${offset} 已越过末尾（总 ${page.totalChars} 字符）`, data: {totalChars: page.totalChars}})
    }
    return wrap({
        success: true,
        data: {
            artifactCode, name: row.name || '', offset, limit,
            text: page.text,
            totalChars: page.totalChars,
            remainingChars: page.remainingChars,
            hasMore: page.hasMore,
            sha256: row.sha256 || '',
            ...(v.warnings.length ? {normalized: v.warnings} : {}),
        },
    })
}

export default {READ_ARTIFACT_TOOL_NAME, DEFAULT_LIMIT_CHARS, MAX_LIMIT_CHARS, buildReadArtifactTools, isReadArtifactTool, validateReadArgs, sliceArtifactText, executeReadArtifactTool}
