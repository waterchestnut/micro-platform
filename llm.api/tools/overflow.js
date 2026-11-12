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
    /** ref 的取法只有一份（resolveToolRef）：两处各认一次就会在一处漏掉老形状 */
    return list.find((x) => resolveToolRef(x) === ref) || null
}

/** 找不到留档时的说明：三种真实原因都要说出来，不能只说"不存在" */
export const TOOL_RESULT_UNARCHIVED = '找不到该标识的留档内容。留档只在"结果被裁剪过"时产生：'
    + '未裁剪的结果全文本来就在 process.toolCalls[].result 里，不需要再取。'
    + '换 ref 或换一轮提问都不会有结果——这一轮确实没有留下这份正文。'

/**
 * @description 把留档里的 ref 归一（老形状只有 tool_call_id）
 * @param {Object} entry 一条留档
 * @returns {String|null} ref
 */
export function resolveToolRef(entry) {
    if (!entry || typeof entry !== 'object') {
        return null
    }
    return entry.ref ?? entry.tool_call_id ?? null
}

/**
 * @description 组装"按 ref 取工具结果全文"的响应（纯函数，不碰 dac）
 * @param {Object} params 入参
 * @param {Object|null} params.entry `extInfo.toolOverflows` 里命中的条目
 * @param {String} params.ref 请求的标识
 * @param {Number} [params.offset] 起始字符
 * @param {Number} [params.limit] 长度（上限同模型侧 `OVERFLOW_MAX_LIMIT`）
 * @returns {{ok: Boolean, statusCode?: Number, error?: String, data?: Object}} 结果
 *
 * 四条边界都有对应现实，不是防御性凑数：
 * - **条目不存在** ⇒ 404 + 常量 `TOOL_RESULT_UNARCHIVED`：绝大多数情况是"这条结果根本没被裁剪过"，
 *   说成"记录不存在"会让人以为数据丢了；
 * - **超出留档上限**（`stored:false`，即原文长过 `limits.overflowStoreChars`）⇒ 尾部**任何地方都不存在**，
 *   这时必须明说"能取回的只有前 availableChars 字"，而不是静默给一段看起来完整的正文；
 * - **offset 越过留档长度** ⇒ 空正文 + `remaining:0`，仍然 200：翻页到尽头是正常终止，不是错误；
 * - **limit 与模型侧共用 `sliceOverflow`** ⇒ 一份切分逻辑，两处消费方（前端与模型）不会漂成两套翻页语义。
 *   `source:'archive'` 是刻意的：取回的是**档案副本**，可能与当时流里的全文不同源。
 */
export function buildToolResultPayload(params = {}) {
    const {entry, ref, offset, limit} = params
    if (!entry) {
        return {ok: false, statusCode: 404, error: TOOL_RESULT_UNARCHIVED}
    }
    const content = typeof entry.content === 'string' ? entry.content : ''
    const slice = sliceOverflow({content, offset, limit})
    const stored = entry.stored === false ? false : (entry.stored === true ? true : null)
    return {
        ok: true,
        data: {
            ref: resolveToolRef(entry) ?? (ref || null),
            tool: entry.tool || null,
            /** 原文真实字符数（裁剪前） */
            chars: Number.isFinite(entry.chars) ? entry.chars : content.length,
            stored,
            /** 留档里实际存了多少字：stored=false 时这是唯一可取的范围 */
            availableChars: content.length,
            content: slice.text,
            offset: slice.offset,
            end: slice.end,
            remaining: slice.remaining,
            truncatedMore: slice.truncatedMore,
            source: 'archive',
            note: stored === false
                ? '该结果超出留档上限，尾部未留存：可取回的范围止于留档边界'
                : '取回的是档案副本，可能与当时流式下发的正文不同源',
        },
    }
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
