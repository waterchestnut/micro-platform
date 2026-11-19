/**
 * @fileOverview read_attachment 工具（附件授权前门，B-1 属主拍板②）
 * @module services/core/attachment/readAttachmentTool
 * @description
 * 形状照抄 readArtifactTool 的纪律：**纯件 + IO 注入**（schema/参数/判定/钳制全离线可测，
 * 取快照与 doc.api 提取是两个注入的 deps）。出错一律 success:false 回给模型，不抛断聊天循环。
 *
 * 授权链（判据单源 `session/taskAttachments.js`，这里一行比较都不写）：
 * taskContext.rootCode → root 行的 params.attachments 快照 → fileCode ∈ 快照 → doc.api
 * `/file/extract/text`。doc.api 侧自带 MAX_TEXT 钳（truncated 透传），我们只在返回给模型的
 * 正文上再加一道 llm 侧预算（maxChars，默认 12000——与 segment 文本预算同量级，防一次附件
 * 读吃掉半窗上下文）。
 *
 * ⚠️ 这个工具**只随任务上下文注册**（llmChat 接线判 `taskContext && enabled`）：普通轮拿到
 * 把手也没有授权面可查，与其运行时拒话不如不给这个选项——少一次"模型试了、被拒、再试"的烧轮。
 */
import {decideAttachmentAccess, snapshotAttachmentAccess} from '../session/taskAttachments.js'

export const READ_ATTACHMENT_TOOL_NAME = 'read_attachment'

/** llm 侧正文预算（字符）：doc.api 钳是第一层，这里是进上下文前的第二层 */
export const DEFAULT_MAX_CHARS = 12000
/** 硬上限：与 overflow 读面同纪律，参数说多少也不能越过这个 */
export const MAX_CHARS_LIMIT = 48000

/**
 * @description 构造 read_attachment 工具定义
 * @param {String} [toolName] 工具名（默认 read_attachment）
 * @returns {Object[]} tools 数组片段
 */
export function buildReadAttachmentTools(toolName = READ_ATTACHMENT_TOOL_NAME) {
    return [{
        type: 'function',
        function: {
            name: toolName,
            description: [
                '按 fileCode 读取本任务发起会话上传的附件纯文本（pdf/docx/xlsx/csv/html/txt/md/json/图片均可，doc.api 提取）。',
                '只能读"可用附件"清单里列出的 fileCode；清单外的读不到，这是授权红线不是故障。',
                `返回 text/chars/truncated；正文超 ${DEFAULT_MAX_CHARS} 字会被钳断（truncatedByLlm=true），需要时说明只取到了前段。`,
            ].join(''),
            parameters: {
                type: 'object',
                properties: {
                    fileCode: {type: 'string', description: '附件把手（来自可用附件清单）'},
                },
                required: ['fileCode'],
            },
        },
    }]
}

/**
 * @description 是否 read_attachment 工具
 * @param {String} toolName 工具名
 * @returns {Boolean}
 */
export function isReadAttachmentTool(toolName) {
    return toolName === READ_ATTACHMENT_TOOL_NAME
}

function toolMessage(toolCall, body) {
    return {tool_call_id: toolCall?.id || '', role: 'tool', content: JSON.stringify(body)}
}

/**
 * 执行一次 read_attachment。**零直接 IO**：快照来自 deps.getRootParams(rootCode)（null=读不到），
 * 文本来自 deps.extractText(fileCode)。判定全走 taskAttachments 单源表。
 * @param {Object} p
 * @param {Object} p.toolCall OpenAI toolCall（arguments 是 JSON 串）
 * @param {Object|null} [p.taskContext] run 的任务上下文（rootCode 在里面）
 * @param {Object} p.deps {getRootParams, extractText}
 * @param {Object} [p.limits] {maxChars}
 * @returns {Promise<Object>} tool 消息（success 形状恒可解析）
 */
export async function executeReadAttachmentTool({toolCall, taskContext = null, deps = {}, limits = {}} = {}) {
    let fileCode = ''
    try {
        const args = JSON.parse(toolCall?.function?.arguments || '{}')
        fileCode = String(args?.fileCode || '')
    } catch {
        return toolMessage(toolCall, {success: false, error: 'read_attachment 参数解析失败：arguments 必须是含 fileCode 的 JSON', tool: READ_ATTACHMENT_TOOL_NAME})
    }
    /** 快照先取（root 行 params.attachments）。**null=不知道**（root 行读不到/不存在），
     *  空数组=知道且确实没附件——两者话术不同，判据表分开（"没附件"与"账读不动"是两句真话） */
    let snapshot = null
    if (taskContext?.rootCode) {
        try {
            const params = await deps.getRootParams(taskContext.rootCode)
            snapshot = params ? snapshotAttachmentAccess(params.attachments || []) : null
        } catch { /* 读失败=null=不知道 ⇒ deny(root-unreadable) */ }
    }
    const d = decideAttachmentAccess({taskContext, fileCode, snapshot})
    if (!d.allow) {
        return toolMessage(toolCall, {success: false, error: d.message, authorization: d.reason, tool: READ_ATTACHMENT_TOOL_NAME})
    }
    try {
        const ret = await deps.extractText(d.fileCode)
        const maxChars = Math.max(1, Number(limits.maxChars) || DEFAULT_MAX_CHARS)
        const hard = Math.min(maxChars, MAX_CHARS_LIMIT)
        const text = String(ret?.text ?? '')
        const clamped = text.length > hard
        return toolMessage(toolCall, {
            success: true,
            data: {
                fileCode: d.fileCode,
                docType: ret?.docType || 'unknown',
                viaOcr: !!ret?.viaOcr,
                text: clamped ? text.slice(0, hard) : text,
                chars: clamped ? hard : text.length,
                /* 三层如实：doc.api 自己的截断 + llm 侧钳 + 原始长度 */
                truncatedByDocApi: !!ret?.truncated,
                truncatedByLlm: clamped,
                sourceChars: text.length,
            },
            tool: READ_ATTACHMENT_TOOL_NAME,
        })
    } catch (e) {
        return toolMessage(toolCall, {success: false, error: `附件文本提取失败：${String(e?.message || e).slice(0, 300)}`, tool: READ_ATTACHMENT_TOOL_NAME})
    }
}

export default {
    READ_ATTACHMENT_TOOL_NAME, buildReadAttachmentTools, isReadAttachmentTool, executeReadAttachmentTool,
    DEFAULT_MAX_CHARS, MAX_CHARS_LIMIT,
}
