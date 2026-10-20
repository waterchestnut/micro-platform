/**
 * @fileOverview 超长文本裁剪（工具/Skill/RAG 结果入上下文前）
 * @module tools/truncate
 * @description 工具结果原样入 `messages` 是会出事的：一次网页抓取或 PDF 解析动辄数十万字符，
 * 直接把上下文撑爆（沙箱接入后 stdout 更容易放大这个问题）。
 * 这里只做一件事：**按 token 预算裁剪，并告诉模型被裁了多少、去哪看剩下的**，
 * 而不是静默截断——静默截断会让模型把半截内容当成全部事实。
 */

let calcTextTokenCount = null

/** 懒加载计数器：openai/util.js 会读 llm 全局，纯函数测试环境里不能被它拖住 */
async function loadCounter() {
    if (calcTextTokenCount) {
        return calcTextTokenCount
    }
    try {
        const mod = await import('../services/openai/util.js')
        calcTextTokenCount = mod.calcTextTokenCount
    } catch {
        calcTextTokenCount = null
    }
    return calcTextTokenCount
}

/** 按字符估算 token（取不到分词器时的兜底，故意估大不估小） */
export function estimateTokens(text) {
    const s = String(text || '')
    let cjk = 0
    for (const ch of s) {
        if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)) {
            cjk++
        }
    }
    return cjk + Math.ceil((s.length - cjk) / 4)
}

/**
 * @description 计算文本 token 数
 * @author xianyang
 * @param {String} text 文本
 * @param {Object} [options] {tokenizer}
 * @returns {Promise<Number>} token 数
 */
export async function textTokens(text, options = {}) {
    if (!text) {
        return 0
    }
    const counter = await loadCounter()
    if (counter && options.tokenizer) {
        try {
            return counter(String(text), options.tokenizer)
        } catch {
            /** 分词器不可用（如未知编码名）时退回估算，不能因此中断请求 */
        }
    }
    return estimateTokens(text)
}

/**
 * @description 按 token 预算裁剪文本，保留头部与可选尾部
 *
 * 预算是硬约束：`headChars`/`tailChars` 是"最多留这么多"的上限，不是下限，
 * 预算不够时头部与尾部一起收缩到 `floorChars`（默认 20 字），
 * 否则会出现"限制了 30 tokens、实际塞进去 1200 字符"的反向结果。
 * @author xianyang
 * @param {String|Object} text 原文（对象会 JSON 化）
 * @param {Object} [options] 选项
 * @param {Number} [options.maxTokens] token 上限，<=0 表示不裁
 * @param {Number} [options.headChars] 头部最多保留的字符数
 * @param {Number} [options.tailChars] 尾部最多保留的字符数，0 表示只留头部
 * @param {Number} [options.floorChars] 收缩下限，保证不留空
 * @param {String} [options.tokenizer] 分词器名
 * @returns {Promise<Object>} {text, truncated, originalTokens, keptTokens, droppedChars}
 */
export async function truncateText(text, options = {}) {
    /** 对象内容要 JSON 化：String({a:1}) 会得到 '[object Object]'，裁完模型什么也看不到 */
    const src = typeof text === 'string' ? text
        : (text === null || text === undefined ? ''
            : (typeof text === 'object' ? JSON.stringify(text) : String(text)))
    const maxTokens = Number(options.maxTokens) > 0 ? Number(options.maxTokens) : 0
    const headChars = Number(options.headChars) > 0 ? Number(options.headChars) : 900
    const tailChars = Number(options.tailChars) > 0 ? Number(options.tailChars) : 0
    const floorChars = Number(options.floorChars) > 0 ? Number(options.floorChars) : 20
    const originalTokens = await textTokens(src, options)
    if (!maxTokens || originalTokens <= maxTokens) {
        return {text: src, truncated: false, originalTokens, keptTokens: originalTokens, droppedChars: 0}
    }
    /** head 与 tail 按同一刻度收缩，尾部不能独自把预算撑爆 */
    const bodyOf = (cut) => {
        const tail = tailChars > 0 && src.length > cut + tailChars ? Math.min(tailChars, cut) : 0
        return tail > 0 ? `${src.slice(0, cut)}\n……\n${src.slice(-tail)}` : src.slice(0, cut)
    }
    const ratio = Math.max(0.02, maxTokens / originalTokens)
    let cut = Math.max(floorChars, Math.min(headChars, Math.floor(src.length * ratio)))
    let kept = ''
    let tokens = originalTokens
    for (let i = 0; i < 24; i++) {
        const body = bodyOf(cut)
        tokens = await textTokens(body, options)
        if (tokens <= maxTokens) {
            kept = body
            break
        }
        if (cut <= floorChars) {
            break
        }
        cut = Math.max(floorChars, Math.floor(cut * 0.7))
    }
    if (!kept) {
        kept = bodyOf(Math.min(floorChars, src.length))
        tokens = await textTokens(kept, options)
    }
    return {
        text: kept,
        truncated: true,
        originalTokens,
        keptTokens: tokens,
        droppedChars: Math.max(0, src.length - kept.length),
    }
}

/**
 * @description 生成还给模型的裁剪说明
 * 必须显式告知"被裁了、还剩多少、如何取全文"，否则模型会把半截内容当全部事实。
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.result truncateText 的结果
 * @param {String} [params.ref] 全文取回标识
 * @param {String} [params.hint] 取回方式说明
 * @returns {String} 裁剪后的正文（含说明）
 */
export function renderTruncated(params = {}) {
    const {result, ref, hint} = params
    if (!result?.truncated) {
        return result?.text || ''
    }
    const marks = [`原文约 ${result.originalTokens} tokens，已裁剪至约 ${result.keptTokens} tokens，省略 ${result.droppedChars} 字符`]
    if (ref) {
        marks.push(`全文标识 ${ref}`)
    }
    if (hint) {
        marks.push(hint)
    }
    return `${result.text}\n\n[内容已裁剪：${marks.join('；')}]`
}

/**
 * @description 把 OpenAI 的 tool 消息按预算就地裁剪，返回新对象（不改入参）
 * @author xianyang
 * @param {Object} toolMessage 工具消息 {role:'tool', tool_call_id, content}
 * @param {Object} [options] 裁剪选项
 * @returns {Promise<Object>} {message, truncated, originalTokens, keptTokens}
 */
export async function truncateToolMessage(toolMessage, options = {}) {
    const content = typeof toolMessage?.content === 'string' ? toolMessage.content : JSON.stringify(toolMessage?.content ?? '')
    const result = await truncateText(content, options)
    if (!result.truncated) {
        return {message: toolMessage, truncated: false, originalTokens: result.originalTokens, keptTokens: result.keptTokens}
    }
    return {
        message: {...toolMessage, content: renderTruncated({result, ref: options.ref, hint: options.hint})},
        truncated: true,
        originalTokens: result.originalTokens,
        keptTokens: result.keptTokens,
    }
}

export default {estimateTokens, textTokens, truncateText, renderTruncated, truncateToolMessage}
