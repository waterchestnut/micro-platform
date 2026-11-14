/**
 * @fileOverview 下发给模型的 save_artifact 工具（PR-H2：沙箱产物入库的模型侧入口）
 * @module services/core/artifact/saveArtifactTool
 * @description
 * §9.1 line 774 的模型面：`save_artifact(path, name?, kind?)`——模型只**申报路径**，
 * 字节由服务端经 execd 拉取（模型永远见不到 doc.api 地址/凭据，也交不出"内容参数"让你替它信一份）。
 * 本模块是纯件（同 planTool/codeTool 的"形与执行"，刻意不碰 execChat）：
 *   - `buildSaveArtifactTools()`：schema；
 *   - `isSaveArtifactTool(name)` / `saveArtifactToolEnabled(cfg)`：默认关（每个新能力先可见后按需开，同 plan_enabled）；
 *   - `validateSaveArtifactArgs()`：路径/名称/类型的归一与拒绝，**修正与拒绝全部回吐**（静默修正是这类功能最阴的失效）；
 *   - `deriveIntakeTask()`：把"工具参数+调用上下文"折算成 artifactIntake 的 task（幂等键 §7 line 741 的组装在这，
 *     纯函数，接线刀给真 genCode/runIntake）；
 *   - `executeSaveArtifactTool()`：编排注入槽的执行体。
 * §13 门覆盖清单里 save_artifact 在列（文件写路径的拦截率要与 shell 同级）——那是执行器/门那刀的验收项；
 * 这里的对应物是**入参边界**：只收 /workspace/ 下的绝对路径、拒 `..`、name 不带分隔符。
 * （诚实注记：沙箱内本就可 run_code 任意读，路径限制是**语义边界**——产物应产自工作区；安全边界在
 * 字节上限、doc.api 地址/凭据不进模型视野、以及门那刀的拦截。）
 */

import {INTAKE_ERRORS} from './intakeErrors.js'

export const SAVE_ARTIFACT_TOOL_NAME = 'save_artifact'

/** 路径策略：workspace 下绝对路径（§9.1 的产物语义），段内不许 . 开头的穿越件 */
const WORKSPACE_PREFIX = '/workspace/'

/** 类型先按 §7 line 733 的已知集（file=普通产物，data=plan.json/progress.md 这类结构化数据） */
export const ARTIFACT_KINDS = ['file', 'data']

/**
 * @description 构造 save_artifact 工具定义
 * @returns {Object[]} tools 数组片段
 */
export function buildSaveArtifactTools() {
    return [{
        type: 'function',
        function: {
            name: SAVE_ARTIFACT_TOOL_NAME,
            description: [
                '把沙箱 /workspace/ 下你生成的文件登记为会话产物（报告、数据、plan.json 等）。',
                '只申报沙箱内绝对路径；系统会自己去取字节并入库，取回结果里给出 artifactCode 与可访问地址。',
                '不能用它读宿主文件、传 URL 或提交内容本身；同名再次保存会形成新版本。',
            ].join(''),
            parameters: {
                type: 'object',
                properties: {
                    path: {type: 'string', description: '沙箱内绝对路径，须在 /workspace/ 下，如 /workspace/report.pdf'},
                    name: {type: 'string', description: `可选：展示文件名（缺省取路径尾段，≤${120} 字符）`},
                    kind: {type: 'string', enum: ARTIFACT_KINDS, description: "可选：file(默认)|data(结构化数据如 plan.json)"},
                },
                required: ['path'],
            },
        },
    }]
}

/**
 * @description 是否 save_artifact 工具
 * @param {String} toolName 工具名
 * @returns {Boolean} 是否是
 */
export function isSaveArtifactTool(toolName) {
    return toolName === SAVE_ARTIFACT_TOOL_NAME
}

/**
 * @description 该不该给这次请求下发 save_artifact（默认关；且没沙箱就没有意义）
 * @param {Object} [artifactConfig] `llm.config.artifactConfig`
 * @param {Object} [sandboxConfig] `llm.config.sandboxConfig`
 * @returns {Boolean} 是否下发
 */
export function saveArtifactToolEnabled(artifactConfig = {}, sandboxConfig = {}) {
    return artifactConfig?.enabled === true && sandboxConfig?.enabled === true
}

/**
 * @description 入参归一/校验（纯函数）
 * @param {Object} args 模型给的参数
 * @param {Number} [maxNameChars] name 上限
 * @returns {{ok:Boolean, error?:String, value?:{path:String,name:String,kind:String}, warnings:String[]}} 结果
 *
 * 拒绝的口径：path 非 /workspace/ 绝对路径或含 `..` 段；name 含路径分隔符/控制字符/超长。
 * 宽容的口径（修而留痕）：kind 不在已知集 ⇒ 按 file 处理并进 warnings——类型是展示语义，不值得为它整次失败。
 */
export function validateSaveArtifactArgs(args = {}, {maxNameChars = 120} = {}) {
    const warnings = []
    const rawPath = String(args.path ?? '').trim()
    if (!rawPath) {
        return {ok: false, error: 'path 不能为空（沙箱内 /workspace/ 下的绝对路径）', warnings}
    }
    if (!rawPath.startsWith(WORKSPACE_PREFIX)) {
        return {ok: false, error: `path 必须是 ${WORKSPACE_PREFIX} 下的绝对路径，收到 ${rawPath.slice(0, 120)}`, warnings}
    }
    if (rawPath.split('/').some((seg) => seg === '..')) {
        return {ok: false, error: 'path 不允许 .. 段', warnings}
    }
    if (rawPath.endsWith('/')) {
        return {ok: false, error: 'path 是目录，产物要具体文件', warnings}
    }
    const tail = rawPath.split('/').pop()
    let name = args.name === undefined || args.name === null ? '' : String(args.name).trim()
    if (name) {
        if (name.length > maxNameChars) {
            return {ok: false, error: `name 超过 ${maxNameChars} 字符`, warnings}
        }
        if (/[/\\\r\n\t\0]/.test(name)) {
            return {ok: false, error: 'name 不能含路径分隔符或控制字符', warnings}
        }
    } else {
        name = tail
    }
    let kind = args.kind === undefined || args.kind === null ? 'file' : String(args.kind).trim().toLowerCase()
    if (!ARTIFACT_KINDS.includes(kind)) {
        warnings.push(`kind=${JSON.stringify(args.kind)} 不在已知集 ${ARTIFACT_KINDS.join('|')}，按 file 处理`)
        kind = 'file'
    }
    return {ok: true, value: {path: rawPath, name, kind}, warnings}
}

/**
 * @description 把工具参数+调用上下文折算成 artifactIntake 的 task（纯函数，标识由注入的 genCode 造）
 * @param {Object} params 入参
 * @param {{path:String,name:String,kind:String}} params.value validate 通过的归一值
 * @param {Object} params.context 调用上下文（conversationCode/channel/userCode/runCode/toolCallId/sandboxId）
 * @param {Function} params.genCode (prefix) => String 标识生成（接线刀注入；测试给可控假件）
 * @param {Object} [params.limits] {maxTotalBytes, sliceBytes}
 * @returns {Object} runIntake 的 task（幂等键 §7 line 741：`${runCode}:${toolCallId}`）
 */
export function deriveIntakeTask({value, context = {}, genCode, limits = {}} = {}) {
    if (typeof genCode !== 'function') {
        throw new Error('deriveIntakeTask 需要注入 genCode（标识生成属接线面）')
    }
    const artifactCode = genCode('art')
    const missing = ['runCode', 'toolCallId', 'sandboxId', 'conversationCode'].filter((k) => !context[k])
    if (missing.length) {
        throw new Error(`intake task 缺上下文：${missing.join(',')}`)
    }
    return {
        artifactCode,
        /** 版本链先立单元素链（自己为根）；"同名再存=新版本"的 parent 解析要读账，归接线刀 */
        version: 1,
        parentArtifactCode: '',
        lineageRootArtifactCode: artifactCode,
        conversationCode: context.conversationCode,
        channel: context.channel || '',
        userCode: context.userCode || '',
        runCode: context.runCode,
        toolCallId: context.toolCallId,
        idempotencyKey: `${context.runCode}:${context.toolCallId}`,
        sandboxId: context.sandboxId,
        path: value.path,
        name: value.name,
        kind: value.kind,
        /** fileCode 也在这里分配：先有把手再传输，alloc-without-record 才可观测（docApiUpload 的强制入参） */
        fileCode: genCode('docfile'),
        maxTotalBytes: limits.maxTotalBytes,
        sliceBytes: limits.sliceBytes,
    }
}

/**
 * @description 执行一次 save_artifact（编排注入槽；出错全走 success:false，不抛断聊天循环）
 * @param {Object} params 入参
 * @param {Object} params.toolCall 工具调用（OpenAI 形态）
 * @param {Object} params.context 调用上下文（见 deriveIntakeTask）
 * @param {Object} [params.artifactConfig] 开关与上限
 * @param {Object} [params.sandboxConfig] 只用于 enabled 判定
 * @param {Function} [params.runIntake] artifactIntake.runIntake（接线刀注入；缺=未接线，如实回错）
 * @param {Function} [params.genCode] 标识生成
 * @returns {Promise<Object>} OpenAI tool 消息体
 */
export async function executeSaveArtifactTool({toolCall, context = {}, artifactConfig = {}, sandboxConfig = {}, runIntake, genCode} = {}) {
    const callId = toolCall?.id
    const wrap = (obj) => ({tool_call_id: callId, role: 'tool', content: JSON.stringify(obj)})
    let args = {}
    try {
        args = JSON.parse(toolCall?.function?.arguments || '{}')
    } catch {
        return wrap({success: false, error: '参数不是合法 JSON'})
    }
    if (!saveArtifactToolEnabled(artifactConfig, sandboxConfig)) {
        return wrap({success: false, error: '产物保存未开放（artifact_enabled，且需 sandbox_enabled）'})
    }
    const v = validateSaveArtifactArgs(args, {maxNameChars: Number(artifactConfig.maxNameChars) || 120})
    if (!v.ok) {
        return wrap({success: false, error: v.error, warnings: v.warnings})
    }
    if (typeof runIntake !== 'function' || typeof genCode !== 'function') {
        return wrap({success: false, error: `${INTAKE_ERRORS.TOOL_WIRING_NOT_READY}：save_artifact 接线未就绪（缺 runIntake/genCode）`, warnings: v.warnings})
    }
    let task
    try {
        task = deriveIntakeTask({
            value: v.value,
            context: {...context, toolCallId: callId},
            genCode,
            limits: {maxTotalBytes: artifactConfig.maxFileBytes, sliceBytes: artifactConfig.sliceBytes},
        })
    } catch (e) {
        return wrap({success: false, error: String(e?.message || e), warnings: v.warnings})
    }
    try {
        const ret = await runIntake(task, /* deps 由接线刀组装；纯件测试注入假编排 */)
        if (!ret || ret.ok !== true) {
            return wrap({
                success: false,
                error: String(ret?.error || 'intake 未成功').slice(0, 500),
                data: {artifactCode: task.artifactCode, state: ret?.state, failedAt: ret?.failedAt, compensations: ret?.compensations},
                warnings: v.warnings,
            })
        }
        return wrap({
            success: true,
            data: {
                artifactCode: ret.artifactCode,
                fileCode: ret.fileCode,
                fileUrl: ret.fileUrl,
                name: v.value.name,
                kind: v.value.kind,
                sizeBytes: ret.sizeBytes,
                sha256: ret.sha256,
            },
            warnings: v.warnings,
        })
    } catch (e) {
        return wrap({success: false, error: String(e?.message || e).slice(0, 500), warnings: v.warnings})
    }
}

export default {SAVE_ARTIFACT_TOOL_NAME, ARTIFACT_KINDS, buildSaveArtifactTools, isSaveArtifactTool, saveArtifactToolEnabled, validateSaveArtifactArgs, deriveIntakeTask, executeSaveArtifactTool}
