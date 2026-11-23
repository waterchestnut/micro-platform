/**
 * @fileOverview skill 写面幂等判据（纯函数族）
 * @module services/core/skill/skillWriteIdempotency
 * @description
 * B-4 二期的前置件（设计 §4:114"带副作用的 child 标 idempotencyKey"，属主拍板② 2026-11-19）：
 * 编排 child 的模型循环能拿到 skill/MCP 写面工具（doc.api 上传/PPT 生成类），崩溃重放或
 * sealed-continuation 双投递时**外部动作会重复**。execClaim 只防并发，防不了
 * "副作用已发生、账行还是 0、租约已过期"的重放——这一层补的就是那个洞。
 *
 * 键的口径不是新发明：`${runCode}:${toolCallId}` 与 artifactSchema §7 line 741 的
 * idempotencyKey **同形同语义**（llmChat 的 runCode=messageCode，:1901 注释是单源）。
 * 三层判据的分工也照抄 artifact intake 的先例：本文件管"这步该不该走"（纯表），
 * 接线层管"账还是我以为的样子吗"（claim 唯一索引兜并发），dac 管落库。
 *
 * ⚠️ 白名单是**运维声明**而不是内容证明：`writeTools` 说哪些工具是写面，闸就只约束哪些。
 * 所以 B-4 解锁判据（recoverPolicy.recoverDirectAllowed 的 skillWriteBound）必须由
 * 接线方注入"启用且名单非空"两个事实，缺一不可——闸关着或名单空着都不许洗成 safe。
 */

/** 决策理由全词表（穷举测试逐项断言；新状态进表必须同时进测试，不留 default 分支吞错）。
 *  proposed-unconfirmed/abandoned-hit（feature-map 刀4）：写面三段式的 refusal 档——
 *  闸见到未确认提案=模型绕过确认环直调，与 started-hit 同危险取向（宁拒不双跑/不静默执行）。 */
export const GATE_REASONS = ['gate-off', 'not-write', 'no-key', 'done-hit', 'started-hit', 'unknown-status', 'first-seen', 'proposed-unconfirmed', 'abandoned-hit']

/** started 形态回给模型的话——它要能明白"不是失败重来的理由，是别重做同一件事" */
export const WRITE_STARTED_MSG = '写面幂等闸：同一 run 同一 toolCallId 有一次未完成的先前执行（副作用可能已发生），本次未重复执行；如需重做请发起新的调用'

/**
 * 组装幂等键（§7 line 741 口径：两段都齐才成键；缺失 ⇒ null 由调用方走豁免分支）。
 * @param {Object} params
 * @param {String} params.runCode run 标识（llmChat=messageCode）
 * @param {String} params.toolCallId 模型给的 toolCall.id
 * @returns {String|null} `runCode:toolCallId` 或 null
 */
export function buildSkillWriteKey({runCode = '', toolCallId = ''} = {}) {
    if (!runCode || !toolCallId) return null
    return `${runCode}:${toolCallId}`
}

/**
 * 白名单匹配：精确名 或 `前缀/*`（'doc_api/*' 命中 'doc_api/upload'）。
 * 刻意不做启发式动词分类——"按函数名猜语义"是 run-plan v1.80 点名的病。
 * @param {String} toolName 工具名
 * @param {String[]} [writeTools] 白名单（运维配置，单源）
 * @returns {Boolean} 是否写面
 */
export function matchWriteTool(toolName, writeTools = []) {
    if (!toolName || !Array.isArray(writeTools) || writeTools.length === 0) return false
    return writeTools.some((rule) => {
        if (!rule) return false
        if (rule.endsWith('/*')) return toolName.startsWith(rule.slice(0, -1))
        return rule === toolName
    })
}

/**
 * 闸门决策表（纯表，无 IO）：六档理由穷举，见 GATE_REASONS。
 * - gate-off：enabled 非显式 true ⇒ **逐字节现网不变**（passthrough，接线层连账都不查）；
 * - not-write：不在白名单 ⇒ passthrough（读面工具重跑无害，不给它们付账查询的钱）；
 * - no-key：runCode/toolCallId 缺失 ⇒ passthrough（闸只加保险不减兼容；legacy 入口不该被新闸拦死）；
 * - done-hit：账上有完整结果 ⇒ replay（返回快照，零副作用——这是全闸的目的）；
 * - started-hit / unknown-status：先前执行没跑完/状态不在词表 ⇒ refuse（"不知道"站危险面，
 *   与 recoverPolicy 的 unknown⇒defer 同一取向：把 unknown 洗成 safe 就是设计禁止的授权旁路）；
 * - first-seen：无账 ⇒ execute（接线层先 claim 再执行）。
 * @param {Object} params
 * @param {Boolean} params.enabled 闸开关
 * @param {String} params.toolName 工具名
 * @param {String[]} [params.writeTools] 写面白名单
 * @param {String|null} params.key buildSkillWriteKey 的结果
 * @param {Object|null} [params.existing] 账行（lookup 结果；接线层 passthrough 档根本不该带它进来）
 * @returns {Object} {action: 'passthrough'|'execute'|'replay'|'refuse', reason, snapshot?, truncated?}
 */
export function decideSkillWriteGate({enabled = false, toolName = '', writeTools = [], key = null, existing = null} = {}) {
    if (enabled !== true) return {action: 'passthrough', reason: 'gate-off'}
    if (!matchWriteTool(toolName, writeTools)) return {action: 'passthrough', reason: 'not-write'}
    if (!key) return {action: 'passthrough', reason: 'no-key'}
    if (!existing) return {action: 'execute', reason: 'first-seen'}
    // 状态词表之外的行（未来漂移/写坏的账）一律 refuse：宁可少跑，不可双跑
    if (existing.status === 'done') {
        return {action: 'replay', reason: 'done-hit', snapshot: existing.resultSnapshot ?? '', truncated: !!existing.snapshotTruncated}
    }
    if (existing.status === 'started') return {action: 'refuse', reason: 'started-hit'}
    // 刀4 两态：proposed=等人确认的存档，闸直调执行=绕过确认环（"写面不静默执行"红线的
    // 运行时执法位）；abandoned=被重提案取代的死行，同 refuse（词表内显式处理，不落 unknown）
    if (existing.status === 'proposed') return {action: 'refuse', reason: 'proposed-unconfirmed'}
    if (existing.status === 'abandoned') return {action: 'refuse', reason: 'abandoned-hit'}
    return {action: 'refuse', reason: 'unknown-status'}
}

/**
 * 提案判据（B0-2 出生段，纯函数；IO 归接线层）。
 * @param {Object} params
 * @param {Object|null} [params.existing] 同键账行现状（lookup 结果）
 * @returns {{action: 'propose'|'repropose'|'refuse', reason: String}}
 *  - propose：无账 ⇒ 新建 proposed 行（paramSnapshot+paramsHash 必填由接线层保证）
 *  - repropose：同键旧行是 proposed ⇒ 旧行标 abandoned、新建（R3-5"一键至多一条活动提案"）
 *  - refuse：同键已 started/done/abandoned——执行链已开过或已死透，重提案只会造出
 *    第二个"等待确认"的假象（模型对同一 toolCallId 二次提案=行为漂移，拒并说清）
 */
export function decideProposal({existing = null} = {}) {
    if (!existing) return {action: 'propose', reason: 'first-seen'}
    if (existing.status === 'proposed') return {action: 'repropose', reason: 'repropose-supersede'}
    if (existing.status === 'started') return {action: 'refuse', reason: 'already-started'}
    if (existing.status === 'done') return {action: 'refuse', reason: 'already-done'}
    return {action: 'refuse', reason: 'abandoned-or-unknown'}
}

/**
 * 确认执行判据（B0-2 的"执行只认存档参数"执法位，纯函数）。
 * @param {Object} params
 * @param {Object|null} [params.existing] proposed 账行
 * @param {String} [params.confirmHash] 确认请求携带的参数哈希（=提案时同一算法；防确认与执行间漂移）
 * @returns {{action: 'proceed'|'refuse', reason: String, useParams?: String}}
 *  proceed 只回存档 paramSnapshot——**调用方拿到什么执行什么，模型本轮再生成的参数不作数**。
 */
export function decideConfirm({existing = null, confirmHash = ''} = {}) {
    if (!existing || existing.status !== 'proposed') return {action: 'refuse', reason: 'not-proposed'}
    const stored = typeof existing.paramsHash === 'string' ? existing.paramsHash.trim() : ''
    if (!stored || !confirmHash || stored !== confirmHash) return {action: 'refuse', reason: 'param-mismatch'}
    return {action: 'proceed', reason: 'confirmed', useParams: existing.paramSnapshot ?? ''}
}

/**
 * 快照钳制：工具结果可能很大，账里存"够重放的最小事实"。
 * 超限截断并打标——重放时模型能看到"这是被钳过的快照"，不冒充全文。
 * @param {String} text 原始 content
 * @param {Number} maxChars 上限（<=0 或非数 ⇒ 不钳，如实全存）
 * @returns {{text: String, truncated: Boolean}}
 */
export function clipSnapshot(text, maxChars = 0) {
    const s = typeof text === 'string' ? text : String(text ?? '')
    const max = Number(maxChars)
    if (!Number.isFinite(max) || max <= 0 || s.length <= max) return {text: s, truncated: false}
    return {text: s.slice(0, max), truncated: true}
}

export default {
    GATE_REASONS, WRITE_STARTED_MSG, buildSkillWriteKey, matchWriteTool, decideSkillWriteGate, decideProposal, decideConfirm, clipSnapshot,
}
