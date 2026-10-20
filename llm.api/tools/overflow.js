/**
 * @fileOverview 工具结果溢出的取回协议（让裁剪留下的指针能用）
 * @module tools/overflow
 * @description PR-11 把超长工具结果按预算裁成片段交给模型，并回显
 * `[内容已裁剪：… 全文标识 <ref>]`。若这个标识取不回任何东西，它就是"死指针"，
 * 模型会拿半截内容当全部事实。本模块提供取回能力：正文本来就在 llm.api 手里
 * （`extInfo.toolOverflows`），所以不需要沙箱也能做。
 *
 * 纯函数、无全局依赖，便于离线断言。
 */

/** 一次返回多少字符 */
export const OVERFLOW_DEFAULT_LIMIT = 4000
/** 单次上限，避免一次翻页又把窗口撑回去 */
export const OVERFLOW_MAX_LIMIT = 20000

export const OVERFLOW_TOOL_NAME = 'read_tool_result'

/**
 * @description 给模型的取回工具定义
 * @author xianyang
 * @returns {Object[]} OpenAI function 格式的 tools 数组片段
 */
export function buildOverflowTools() {
    return [{
        type: 'function',
        function: {
            name: OVERFLOW_TOOL_NAME,
            description: '按裁剪时给出的全文标识，分段读回被裁掉的工具结果原文。上下文里出现"[内容已裁剪…全文标识 xxx]"时使用；一次读不完可带 offset 继续翻。',
            parameters: {
                type: 'object',
                properties: {
                    ref: {type: 'string', description: '裁剪说明里的全文标识（即 tool_call_id）'},
                    offset: {type: 'number', description: '起始字符位置，默认 0'},
                    limit: {type: 'number', description: `本次最多读多少字符，默认 ${OVERFLOW_DEFAULT_LIMIT}，上限 ${OVERFLOW_MAX_LIMIT}`},
                },
                required: ['ref'],
            },
        },
    }]
}

/**
 * @description 判断某个工具名是否属于溢出取回工具
 * @author xianyang
 * @param {String} toolName 工具名
 * @returns {Boolean} 是否是
 */
export function isOverflowTool(toolName) {
    return toolName === OVERFLOW_TOOL_NAME
}

/**
 * @description 按 offset/limit 切一段溢出正文（不抛错，越界给空段并说明）
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.content 全文
 * @param {Number} [params.offset] 起始位置
 * @param {Number} [params.limit] 长度
 * @returns {Object} {text, offset, end, total, remaining, truncatedMore}
 */
export function sliceOverflow(params = {}) {
    const content = typeof params.content === 'string' ? params.content : String(params.content ?? '')
    const total = content.length
    const offset = Math.max(0, Math.floor(Number(params.offset) || 0))
    const wantLimit = Number(params.limit)
    const limit = Math.min(OVERFLOW_MAX_LIMIT, Math.max(1, Number.isFinite(wantLimit) && wantLimit > 0 ? Math.floor(wantLimit) : OVERFLOW_DEFAULT_LIMIT))
    if (offset >= total) {
        return {text: '', offset, end: offset, total, remaining: 0, truncatedMore: false}
    }
    const end = Math.min(total, offset + limit)
    return {
        text: content.slice(offset, end),
        offset,
        end,
        total,
        remaining: total - end,
        truncatedMore: end < total,
    }
}

/**
 * @description 在本轮留档里找某个标识对应的溢出正文
 * @author xianyang
 * @param {Object[]} list extInfo.toolOverflows 形状的对象数组
 * @param {String} ref 全文标识
 * @returns {Object|null} 命中的留档条目
 */
export function findOverflow(list, ref) {
    if (!Array.isArray(list) || !ref) {
        return null
    }
    return list.find(x => x && (x.ref === ref || x.tool_call_id === ref)) || null
}

/**
 * @description 组装取回工具的返回内容（给模型的正文）
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object[]} params.overflows 本轮留档列表
 * @param {String} params.ref 全文标识
 * @param {Number} [params.offset] 起始
 * @param {Number} [params.limit] 长度
 * @returns {Object} {success, data?, error?}
 */
export function readOverflow(params = {}) {
    const hit = findOverflow(params.overflows, params.ref)
    if (!hit) {
        return {
            success: false,
            error: `找不到标识 ${params.ref} 的留档内容。只有本轮被裁剪过的工具结果可取回；本轮之后的内容需要重新执行该工具。`,
        }
    }
    const slice = sliceOverflow({content: hit.content, offset: params.offset, limit: params.limit})
    if (!slice.total) {
        return {success: false, error: `标识 ${params.ref} 的全文未留档（超出留档上限，只保留了量级信息）`}
    }
    return {
        success: true,
        data: {
            ref: params.ref,
            tool: hit.tool || null,
            ...slice,
            /** 明确标注只在当前轮有效，避免模型以为随时能翻出历史 */
            inTurnOnly: true,
        },
    }
}

export default {OVERFLOW_TOOL_NAME, OVERFLOW_DEFAULT_LIMIT, OVERFLOW_MAX_LIMIT, buildOverflowTools, isOverflowTool, sliceOverflow, findOverflow, readOverflow}
