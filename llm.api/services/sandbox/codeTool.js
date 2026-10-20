/**
 * @fileOverview 下发给模型的 run_code 工具（架构上允许模型生成代码，但只在沙箱跑）
 * @module services/sandbox/codeTool
 * @description 这个工具存在的意义就是把"模型写的代码"这件事从**本进程**挪进**沙箱**：
 * 因此它有几个不可协商的约束，写在描述里也写在代码里：
 *   - 只接受语言与代码文本，不接受任何凭据类 env；
 *   - 长度与超时都有硬上限；
 *   - 结果仍走 PR-11 的裁剪通道（超长会被裁并可用 read_tool_result 翻页）；
 *   - `sandboxConfig.enabled` 或 `allowModelCode` 关掉时，工具根本不下发。
 * 出错一律以工具结果的形式回给模型（success:false），不抛断聊天循环。
 */

export const CODE_TOOL_NAME = 'run_code'

/**
 * @description 构造 run_code 工具定义
 * @author xianyang
 * @returns {Object[]} tools 数组片段
 */
export function buildCodeTools() {
    return [{
        type: 'function',
        function: {
            name: CODE_TOOL_NAME,
            description: '在隔离沙箱里执行一段代码并返回标准输出/错误与退出码。用于需要真实计算或验证的代码片段；沙箱内没有宿主凭据，也不能访问宿主文件系统。',
            parameters: {
                type: 'object',
                properties: {
                    code: {type: 'string', description: '要执行的完整代码'},
                    lang: {type: 'string', enum: ['python', 'node'], description: '运行环境，默认 python'},
                    timeoutMs: {type: 'number', description: '本次执行超时毫秒数，受服务端上限约束'},
                },
                required: ['code'],
            },
        },
    }]
}

/**
 * @description 是否 run_code 工具
 * @author xianyang
 * @param {String} toolName 工具名
 * @returns {Boolean} 是否是
 */
export function isCodeTool(toolName) {
    return toolName === CODE_TOOL_NAME
}

/**
 * @description 该不该给这次请求下发 run_code
 * @author xianyang
 * @param {Object} [sandboxConfig] 沙箱配置
 * @returns {Boolean} 是否下发
 */
export function codeToolEnabled(sandboxConfig = {}) {
    return Boolean(sandboxConfig?.enabled && sandboxConfig?.allowModelCode !== false)
}

/**
 * @description 执行一次 run_code
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.toolCall 工具调用
 * @param {Object} params.context 上下文（含 conversationCode）
 * @returns {Promise<Object>} OpenAI tool 消息体
 */
export async function executeCodeTool({toolCall, context = {}} = {}) {
    const callId = toolCall?.id
    const wrap = (obj) => ({tool_call_id: callId, role: 'tool', content: JSON.stringify(obj)})
    let args = {}
    try {
        args = JSON.parse(toolCall?.function?.arguments || '{}')
    } catch {
        return wrap({success: false, error: '参数不是合法 JSON'})
    }
    const cfg = (typeof llm !== 'undefined' ? llm.config?.sandboxConfig : {}) || {}
    if (!codeToolEnabled(cfg)) {
        return wrap({success: false, error: '沙箱执行未开放（sandbox_enabled / sandbox_allowModelCode）'})
    }
    if (!context.conversationCode) {
        return wrap({success: false, error: '缺少会话标识，无法绑定沙箱'})
    }
    const maxChars = Number(cfg.maxCodeChars) || 20000
    if (String(args.code || '').length > maxChars) {
        return wrap({success: false, error: `代码超过 ${maxChars} 字符上限，请拆分后分次执行`})
    }
    try {
        const {runModelCode} = await import('./runner.js')
        const ret = await runModelCode({
            code: args.code,
            lang: args.lang,
            timeoutMs: Number(args.timeoutMs) || undefined,
            conversationCode: context.conversationCode,
            /** 账本要按人归属，缺了就只能记成匿名 */
            userCode: context.userCode,
            channel: context.channel,
        })
        return wrap({
            success: ret.exitCode === 0,
            data: {
                lang: ret.lang,
                exitCode: ret.exitCode,
                stdout: ret.stdout,
                stderr: ret.stderr,
            },
        })
    } catch (e) {
        return wrap({success: false, error: String(e?.message || e).slice(0, 500)})
    }
}

export default {CODE_TOOL_NAME, buildCodeTools, isCodeTool, codeToolEnabled, executeCodeTool}
