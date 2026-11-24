/**
 * @fileOverview 写面 handoff 型（一次性确认 token + 确认时才落库）的接线层
 * @module services/core/skill/skillHandoff
 * @description
 * 判据全在 `skillHandoffPolicy.js`（纯表），账在 skillWriteJournal（proposed→started→done），
 * 这里只编排：签 token / 读账 / 一次性 jti / 兑换时才 grpc 落库。deps 注入纪律同 skillWriteGate：
 * 单测给 fake（dac/consumeJti/execGrpc/resolveHost）真跑全分支，e2e 走真件（懒 import）。
 *
 * 三段：
 * - proposeHandoff：AI 组装参数落 journal.proposed（paramSnapshot=命令+参数信封，paramsHash 冻结），
 *   签一次性 token 返回；**不碰子系统**（零副作用）。同键重提案由 decideProposal 收口（repropose 覆写）。
 * - previewHandoff：验 token（含"确认人=发起人"）→ 读 proposed 行 → 回显参数；不落库、不消费 jti。
 * - redeemHandoff：验 token → SETNX 抢 jti（一次性，redis 挂=拒不放行）→ decideRedeem →
 *   startConfirmed（CAS，双兑只有一个拿到 started 行）→ **此刻才** grpc 落草稿 → settle done。
 *   grpc 失败 ⇒ 行留 started（副作用状态未知，未来重放 refuse），与写面闸同一保守面。
 */
import crypto from 'node:crypto'
import {makeSignedBlob} from '../../../tools/signedBlob.js'
import {
    buildHandoffPayload, verifyHandoffToken, decideRedeem, hashParams, DEFAULT_HANDOFF_TTL_MS,
} from './skillHandoffPolicy.js'
import {buildSkillWriteKey, decideProposal, clipSnapshot} from './skillWriteIdempotency.js'

const logger = (typeof llm !== 'undefined' && llm.logger) || console

function secret() {
    return (typeof llm !== 'undefined' ? llm.config?.cookieSecret : '') || ''
}
function resolveSecret(deps) {
    return deps?.secret ?? secret()
}

/** 从 config.skillHandoff.handoffCommands 查某命令的申报 spec（含 redirect 模板/confirmBaseUrl 无关） */
function handoffSpecOf(commandKey) {
    const list = (typeof llm !== 'undefined' && llm.config?.skillHandoff?.handoffCommands) || []
    return list.find((h) => h.command === commandKey) || null
}
function handoffCfg() {
    const h = (typeof llm !== 'undefined' && llm.config?.skillHandoff) || {}
    const ttlMs = Number(h.tokenTtlMs) > 0 ? Number(h.tokenTtlMs) : DEFAULT_HANDOFF_TTL_MS
    return {
        ttlMs,
        jtiTtlS: Number(h.jtiTtlSeconds) > 0 ? Number(h.jtiTtlSeconds) : Math.ceil(ttlMs / 1000) + 60,
        snapshotMaxChars: Number(h.snapshotMaxChars) > 0 ? Number(h.snapshotMaxChars) : 4000,
    }
}

/** paramSnapshot 信封：redeem 自描述要调哪个技能的哪个命令、带什么参数（对 policy 不透明） */
function envelope({skillName, commandName, params}) {
    return JSON.stringify({skillName, commandName, params: params || {}})
}

/**
 * @description 造 ai-confirm 门户深链（wujie 挂载形制）：`{base}/sub/{clientCode}?{clientCode}={enc(path?confirmToken=)}`
 *   base 空 ⇒ 回相对路径由前端拼。path 已含 query 时用 & 续接 confirmToken。
 * @param {String} baseUrl 门户基址
 * @param {Object} spec {clientCode, path}
 * @param {String} token 一次性确认 token
 * @returns {String}
 */
export function buildHandoffConfirmUrl(baseUrl, spec = {}, token = '') {
    const base = String(baseUrl || '').replace(/\/+$/, '')
    const path = spec.path || '/'
    const sep = path.includes('?') ? '&' : '?'
    // token 是 b64url+.（无 &=?/ 保留字符），原样入内层，只整体编码一次（对齐门户 wujie 实况）
    const inner = `${path}${sep}confirmToken=${token}`
    const sub = `/sub/${spec.clientCode || ''}?${spec.clientCode || ''}=${encodeURIComponent(inner)}`
    return base ? `${base}${sub}` : sub
}

/**
 * @description 提案：落 proposed 存档 + 签一次性确认 token（无副作用）
 * @param {Object} p {runCode, toolCallId, skillName, commandName, params, conversationCode, userCode, deps?}
 * @returns {Promise<Object>} {ok, token?, journalKey?, paramsHash?, reason?}
 */
export async function proposeHandoff({key, runCode = '', toolCallId = '', skillName = '', commandName = 'createDraft', params = {}, conversationCode = '', userCode = '', deps} = {}) {
    if (!skillName) return {ok: false, reason: 'no-skill'}
    if (!userCode) return {ok: false, reason: 'no-user'}
    const finalKey = key || buildSkillWriteKey({runCode, toolCallId})
    if (!finalKey) return {ok: false, reason: 'no-key'}
    const dac = deps?.dac || (await import('../../../daos/core/dac/skillWriteJournalDac.js')).default
    const paramsHash = hashParams(params)
    const paramSnapshot = envelope({skillName, commandName, params})
    let existing = null
    try {
        existing = await dac.lookup(finalKey)
    } catch (e) {
        logger.error(`handoff propose 读账失败: key=${finalKey} ${String(e?.message || e).slice(0, 160)}`)
        return {ok: false, reason: 'store-unavailable'}
    }
    const pd = decideProposal({existing})
    if (pd.action === 'refuse') return {ok: false, reason: pd.reason}   // already-started/done：执行链已开
    try {
        if (pd.action === 'propose') {
            await dac.proposeOnce({key: finalKey, runCode, toolCallId, toolName: skillName, conversationCode, userCode, paramSnapshot, paramsHash})
        } else { // repropose：同键旧提案覆写（一键至多一条活动提案）
            await dac.updateProposed(finalKey, {paramSnapshot, paramsHash})
        }
    } catch (e) {
        logger.error(`handoff propose 写账失败: key=${finalKey} ${String(e?.message || e).slice(0, 160)}`)
        return {ok: false, reason: 'store-unavailable'}
    }
    const {ttlMs} = handoffCfg()
    const jti = crypto.randomUUID()
    const payload = buildHandoffPayload({journalKey: finalKey, userCode, paramsHash, jti, ttlMs})
    const token = makeSignedBlob(resolveSecret(deps), payload)
    return {ok: true, token, journalKey: finalKey, paramsHash, jti}
}

/**
 * @description 预览回显：验 token → 读 proposed 行 → 返回 AI 组装参数（不落库、不消费 jti）
 * @param {Object} p {token, callerUserCode, deps?}
 * @returns {Promise<Object>} {ok, reason?, skillName?, commandName?, params?}
 */
export async function previewHandoff({token = '', callerUserCode = '', deps} = {}) {
    const {ttlMs} = handoffCfg()
    const v = verifyHandoffToken({secret: resolveSecret(deps), token, callerUserCode, now: Date.now(), ttlMs})
    if (!v.ok) return {ok: false, reason: v.reason}
    const dac = deps?.dac || (await import('../../../daos/core/dac/skillWriteJournalDac.js')).default
    let row = null
    try {
        row = await dac.lookup(v.value.journalKey)
    } catch (e) {
        return {ok: false, reason: 'store-unavailable'}
    }
    if (!row || row.status !== 'proposed') return {ok: false, reason: 'not-proposed'}
    let env = {}
    try { env = JSON.parse(row.paramSnapshot || '{}') } catch { /* 坏信封按空回显 */ }
    return {ok: true, skillName: env.skillName || '', commandName: env.commandName || '', params: env.params || {}}
}

/**
 * @description 兑换确认：一次性消费 token → 确认时才 grpc 落库 → settle
 * @param {Object} p {token, callerUserCode, curUserInfo, deps?}
 * @returns {Promise<Object>} {ok, reason?, researchCode?, detail?}
 */
export async function redeemHandoff({token = '', callerUserCode = '', curUserInfo = {}, deps} = {}) {
    const {ttlMs, jtiTtlS, snapshotMaxChars} = handoffCfg()
    const v = verifyHandoffToken({secret: resolveSecret(deps), token, callerUserCode, now: Date.now(), ttlMs})
    if (!v.ok) return {ok: false, reason: v.reason}
    const {journalKey, jti, paramsHash} = v.value
    const dac = deps?.dac || (await import('../../../daos/core/dac/skillWriteJournalDac.js')).default
    // 一次性 jti：抢到=首次可兑，抢不到=重放。redis 挂→拒（fail-closed，绝不用 fail-open 的 acquireOnce）
    const consumeJti = deps?.consumeJti || defaultConsumeJti
    let fresh
    try {
        fresh = await consumeJti(jti, jtiTtlS)
    } catch (e) {
        logger.error(`handoff jti 消费异常(fail-closed 拒兑): ${String(e?.message || e).slice(0, 160)}`)
        return {ok: false, reason: 'store-unavailable'}
    }
    let existing = null
    try {
        existing = await dac.lookup(journalKey)
    } catch (e) {
        return {ok: false, reason: 'store-unavailable'}
    }
    const dec = decideRedeem({claimVerdict: v, alreadyConsumed: !fresh, existing})
    if (dec.action !== 'proceed') return {ok: false, reason: dec.reason}
    // CAS：proposed→started，只有拿到返回行的那次兑换可继续（防并发双兑）
    let started = null
    try {
        started = await dac.startConfirmed(journalKey)
    } catch (e) {
        return {ok: false, reason: 'store-unavailable'}
    }
    if (!started) return {ok: false, reason: 'race-not-proposed'}   // 已被并发兑换推走
    let env = {}
    try { env = JSON.parse(started.paramSnapshot || dec.useParams || '{}') } catch { /* 坏信封下面按无技能拒 */ }
    if (!env.skillName) return {ok: false, reason: 'bad-payload'}
    const resolveHost = deps?.resolveHost || defaultResolveHost
    const execGrpc = deps?.execGrpc || defaultExecGrpc
    let host = ''
    try {
        host = await resolveHost(env.skillName)
    } catch (e) {
        logger.error(`handoff 解析 grpcHost 失败: skill=${env.skillName} ${String(e?.message || e).slice(0, 160)}`)
    }
    if (!host) {
        // 目标不可定位：行停在 started（保守），本次不静默成功
        return {ok: false, reason: 'host-unavailable'}
    }
    let res
    try {
        res = await execGrpc(host, env.skillName, env.commandName || 'createDraft', env.params || {}, {...curUserInfo, handoffAuthorized: true})
    } catch (e) {
        // 执行抛=副作用状态未知，行留 started（未来重放 refuse），绝不谎报成功
        logger.error(`handoff 落库执行异常: ${String(e?.message || e).slice(0, 160)}`)
        return {ok: false, reason: 'exec-failed', detail: String(e?.message || e).slice(0, 200)}
    }
    if (!res || res.success !== true) {
        return {ok: false, reason: 'exec-failed', detail: (res && (res.error || res.message)) || ''}
    }
    // materialize 结果 id：约定 handler 返回 entityId；兼容既有 researchCode/code/id
    const entityId = res.data?.entityId || res.data?.researchCode || res.data?.code || res.data?.id
        || res.data?.data?.entityId || res.data?.data?.researchCode || ''
    // settle started→done（快照=结果）；settle 失败只 warn（副作用已成，行留 started 反而保守）
    try {
        await dac.settle(journalKey, clipSnapshot(JSON.stringify(res.data || {}), snapshotMaxChars))
    } catch (e) {
        logger.warn(`handoff settle 失败(行留 started): key=${journalKey} ${String(e?.message || e).slice(0, 160)}`)
    }
    // 回跳路径：从 config handoffCommands spec.redirect 模板用 {id} 填充（通用化，console 直接跳）
    const spec = handoffSpecOf(`${env.skillName}.${env.commandName || 'createDraft'}`)
    const redirectPath = spec?.redirect && entityId
        ? spec.redirect.replace('{id}', encodeURIComponent(entityId))
        : ''
    return {ok: true, entityId, researchCode: entityId, redirectPath, result: res.data}
}

// ===== 真件默认实现（仅 e2e 走；单测一律 deps 注入 fake） =====
async function defaultConsumeJti(jti, ttlS) {
    const redisClient = (await import('../../../daos/cache/redisClient.js')).default
    return await redisClient.setIfAbsent(`skillhandoff:jti:${jti}`, '1', ttlS)   // 真=首次；假/已存在=重放
}
async function defaultResolveHost(skillName) {
    const grpcSkillDac = (await import('../../../daos/core/dac/grpcSkillDac.js')).default
    const rows = await grpcSkillDac.getTop(1, {skillName})
    return rows?.[0]?.grpcHost || ''
}
async function defaultExecGrpc(host, skillName, commandName, params, curUserInfo) {
    const {execCommand} = await import('../../../grpc/clients/grpcSkillExecutor.js')
    return await execCommand(host, skillName, commandName, params, curUserInfo)
}

/**
 * @description 造 jump 模式深链（无后端落库、无 token）：把 AI 组装 params 编成 query 拼进子系统 create 页
 *   `{base}/sub/{clientCode}?{clientCode}={enc(path?paramsQuery)}`。数组值逗号连接。用户在预填页复核并本人提交。
 * @param {String} baseUrl 门户基址（空=相对）
 * @param {Object} spec {clientCode, path}
 * @param {Object} params AI 组装参数
 * @returns {String}
 */
export function buildJumpUrl(baseUrl, spec = {}, params = {}) {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params || {})) {
        if (v === undefined || v === null) continue
        q.set(k, Array.isArray(v) ? v.join(',') : String(v))
    }
    const path = spec.path || '/'
    const sep = path.includes('?') ? '&' : '?'
    const inner = `${path}${sep}${q.toString()}`
    const base = String(baseUrl || '').replace(/\/+$/, '')
    const sub = `/sub/${spec.clientCode || ''}?${spec.clientCode || ''}=${encodeURIComponent(inner)}`
    return base ? `${base}${sub}` : sub
}

export default {proposeHandoff, previewHandoff, redeemHandoff, buildHandoffConfirmUrl, buildJumpUrl}
