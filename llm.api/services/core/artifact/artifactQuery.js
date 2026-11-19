/**
 * @fileOverview 产物查询/读回的服务面（Agent UI 刀 B 服务端前置）
 * @module services/core/artifact/artifactQuery
 * @description
 * 现状审计（2026-11-19 读码）：artifact 账本、intake、read_artifact 执行体、对账全齐，
 * 但**前端无面**——产物只活在模型工具环里（save_artifact 的返回进模型上下文），用户界面
 * 回答不了"我的产物在哪、内容是什么"。调研（《从 Chat UI 到 Agent UI》第八章）要求
 * Artifact 工作区：聊天区说"已生成《X》"，工作区承载正文/版本/导出。
 *
 * 本件补最小服务端面：两个查询入口，**全部复用既有单源**——
 * - 可见性：`resolveMessageScope`（会话成员制，与 /core/message/list 同一口径，不另造）；
 * - 读回：`executeReadArtifactTool` + `makeArtifactReader`（状态闸/字节上限/doc.api 内网读
 *   全在既有执行体里，这里一行判定都不重写——重写就是第二套真相）；
 * - 列表投影：`projectArtifactRow` 纯函数（字段缺席如实 null，不补 0——关联列同款纪律）。
 */
import conversationDac from '../../../daos/core/dac/conversationDac.js'
import artifactDac from '../../../daos/core/dac/artifactDac.js'
import {resolveMessageScope} from '../messageScope.js'
import {makeArtifactReader} from './intakeWiring.js'
import {executeReadArtifactTool} from './readArtifactTool.js'
import {projectArtifactRow} from './artifactRow.js'

/** projectArtifactRow 在 artifactRow.js（纯件，离线穷举测） */

/**
 * @description 会话成员校验（与 message 面同判据）；非成员/无身份 ⇒ deny 原因如实
 */
async function checkMember(conversationCode, userCode) {
    if (!userCode) return {ok: false, reason: 'no-user'}
    const allowedCodes = await conversationDac.getConversationCodes({userCode})
    const scope = resolveMessageScope({conversationCode}, userCode, allowedCodes)
    // 形状 {ok, reason, filter}（messageScope 契约）——reason='member' 是**成功**理由，
    // 误读成 allowed 会把成员全拒（e2e A1/A3 首红当场抓获）
    return {ok: !!scope.ok, reason: scope.reason || ''}
}

/**
 * @description 某会话的产物清单（工作区列表）。排序 insertTime 新在前；不含他人会话（成员制先行）
 * @param {Object} p
 * @param {String} p.conversationCode
 * @param {String} p.userCode
 * @param {Number} [p.limit]
 */
export async function listArtifactsForUser({conversationCode = '', userCode = '', limit = 50} = {}) {
    if (!conversationCode) return {deny: 'no-conversation'}
    const member = await checkMember(conversationCode, userCode)
    if (!member.ok) return {deny: member.reason}
    const pageSize = Math.max(1, Math.min(Number(limit) || 50, 200))
    const page = await artifactDac.getByPage(1, pageSize, {
        complexFilter: {conversationCode},
        sort: {insertTime: -1},
    })
    return {items: (page?.rows || []).map(projectArtifactRow), total: page?.total ?? (page?.rows || []).length}
}

/**
 * @description 读回产物内容分页（工作区预览）。权限=产物所属会话的成员制；
 * 状态闸/字节上限全在 executeReadArtifactTool（已注销/未入库/broken 的拒法照旧，不在此重造）
 */
export async function readArtifactForUser({artifactCode = '', userCode = '', realName = '', offset = 0, limit} = {}) {
    if (!artifactCode) return {error: 'artifactCode 不能为空'}
    let row = null
    try {
        row = await artifactDac.findByArtifactCode(artifactCode)
    } catch (e) {
        return {error: `查账失败：${String(e?.message || e).slice(0, 160)}`}
    }
    if (!row) return {error: 'not-found'}
    const member = await checkMember(row.conversationCode, userCode)
    if (!member.ok) return {deny: member.reason}
    const config = (typeof llm !== 'undefined' && llm.config) || {}
    const deps = makeArtifactReader({
        docApiConfig: config.docApiConfig || {},
        userInfo: {userCode, realName},
    })
    const out = await executeReadArtifactTool({
        toolCall: {id: 'http-read', function: {arguments: JSON.stringify({artifactCode, offset, limit})}},
        artifactConfig: config.artifactConfig || {},
        deps,
    })
    try {
        return JSON.parse(out?.content || '{}')
    } catch {
        return {success: false, error: '读回结果不是 JSON（执行体形状漂移，需查 executeReadArtifactTool）'}
    }
}
