/**
 * @fileOverview 候选晋升落库
 * @module services/core/memory/promote
 * @description 所有对记忆生效内容的变更都必须写 journal：可回溯、可申诉。
 * 索引同步是尽力而为，失败不回滚权威库，只留 indexedAt 为空由压实任务补。
 */

import memoryCandidateDac from '../../../daos/core/dac/memoryCandidateDac.js'
import memoryAtomDac from '../../../daos/core/dac/memoryAtomDac.js'
import memoryEntityDac from '../../../daos/core/dac/memoryEntityDac.js'
import memoryJournalDac from '../../../daos/core/dac/memoryJournalDac.js'
import memoryNamespaceDac from '../../../daos/core/dac/memoryNamespaceDac.js'
import memoryEventDac from '../../../daos/core/dac/memoryEventDac.js'
import MemoryStatusEnum from '../../../daos/core/enum/MemoryStatusEnum.js'
import {decidePromotion} from './promotion.js'
import {getMemoryStore} from './store/index.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config

async function journal({userCode, channel, actor, op, targetType, targetCode, before, after, evidence, reason, operator}) {
    try {
        await memoryJournalDac.add({
            userCode, channel, actor, op, targetType, targetCode,
            before: before ?? null, after: after ?? null,
            evidence: evidence ?? [], reason,
            operator: operator ? {userCode: operator.userCode, realName: operator.realName} : null,
        })
    } catch (e) {
        logger.error(`写记忆变更日志失败(${op}/${targetType}/${targetCode}): ${e.message}`)
    }
}

/**
 * @description 取同命名空间内生效中的原子，作为冲突判定的比对集
 * @author xianyang
 * @param {Object} params 入参
 * @returns {Promise<Object[]>} 原子列表
 */
export async function loadActiveAtoms({userCode, channel, workspaceId = null, kinds = null}) {
    const rows = await memoryAtomDac.getTop(500, {
        userCode, channel, workspaceId,
        state: MemoryStatusEnum.active.value,
        ...(kinds ? {kinds} : {}),
    }, {confidence: -1, updateTime: -1})
    return rows || []
}

async function syncToStore(atom) {
    try {
        const store = await getMemoryStore()
        if (!store.capabilities?.has?.('semantic')) {
            return null
        }
        await store.upsert({
            userCode: atom.userCode,
            channel: atom.channel,
            workspaceId: atom.workspaceId,
            operator: atom.operator,
            /** kind/topic/state/insertTime 一并带上：向量侧的 state 过滤与主题加权都要用 */
            atoms: [{
                atomCode: atom.atomCode,
                content: atom.content,
                headline: atom.headline || atom.content,
                kind: atom.kind,
                topic: atom.topic,
                state: atom.state,
                insertTime: atom.insertTime,
            }],
        })
        return new Date()
    } catch (e) {
        /** 索引通道未就绪属于预期内状态，不影响记忆在 Mongo 侧生效 */
        logger.warn(`记忆同步到检索索引失败(${atom.atomCode})，留待压实任务补: ${e.message}`)
        return null
    }
}

async function bumpEntities({candidate, atomCode, userCode, channel, operator}) {
    for (const ent of candidate.entities || []) {
        const name = ent?.name?.trim()
        if (!name) {
            continue
        }
        try {
            const exist = await memoryEntityDac.getTop(1, {userCode, channel, name}, {insertTime: 1})
            if (exist?.[0]) {
                const doc = exist[0]
                const dirtyCount = (doc.dirtyCount || 0) + 1
                const regen = config.memory?.entity?.regenThreshold ?? 5
                await memoryEntityDac.update({
                    dirty: true,
                    dirtyCount,
                    atomCodes: [...new Set([...(doc.atomCodes || []), atomCode])],
                }, {entityCode: doc.entityCode})
                if (dirtyCount >= regen) {
                    logger.info(`实体(${name}) 累计 ${dirtyCount} 条变更，达到重生阈值，待压实任务重生成`)
                }
                continue
            }
            await memoryEntityDac.add({
                userCode, channel, name, aliases: [], headline: '', content: '',
                atomCodes: [atomCode], dirty: true, dirtyCount: 1,
                operator: {userCode: operator?.userCode, realName: operator?.realName},
            })
        } catch (e) {
            logger.error(`更新记忆实体失败(${name}): ${e.message}`)
        }
    }
}

/**
 * @description 晋升一条候选为原子
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.candidate 候选（含 content/kind/topic/confidence/evidence/eventCodes/entities/source）
 * @param {String} params.userCode 用户标识
 * @param {String} params.channel 频道标识
 * @param {String} [params.workspaceId] 沙箱工作区
 * @param {Object} [params.operator] 操作人
 * @param {Object} [params.existing] 预载的比对集，避免批量时重复查询
 * @returns {Promise<Object|null>} {action, atomCode} 结果
 */
/**
 * @description 把某条原子的证据事件一并降级。
 * 原子的 state 管住了词法/向量检索，但 gatherRawEvents 读的是 memoryEvent 归档：
 * 只退役原子不退役事件，已作废的事实会借"原始对话回退"重新注入（评测实测到 16.7% 的过时注入）。
 * @author xianyang
 * @param {Object} atom 被退役/被替代的原子
 * @param {String} [state] 事件降级到的状态
 * @returns {Promise<Number>} 实际更新的条数
 */
export async function retireEvidenceEvents(atom, state = MemoryStatusEnum.superseded.value) {
    const codes = [...new Set((atom?.evidence || []).map(e => e?.eventCode).filter(Boolean))]
    if (!codes.length) {
        return 0
    }
    try {
        /** 事件不删，证据链必须可回溯，只是不再作为可注入的原始内容 */
        const ret = await memoryEventDac.update({state}, {eventCode: {$in: codes}})
        return ret?.modifiedCount ?? 0
    } catch (e) {
        logger.error(`降级记忆证据事件失败(${atom?.atomCode}): ${e.message}`)
        return 0
    }
}

export async function promoteCandidate({candidate, userCode, channel, workspaceId = null, operator = null, existing = null}) {
    if (!candidate?.content) {
        return null
    }
    const ns = await memoryNamespaceDac.getByNamespace(userCode, channel, workspaceId)
    const atoms = existing ?? await loadActiveAtoms({userCode, channel, workspaceId})
    const decision = decidePromotion({
        candidate: {...candidate, insertTime: candidate.insertTime || Date.now()},
        existing: atoms,
        config: config.memory?.promotion,
    })

    const baseDoc = {
        userCode,
        channel,
        workspaceId: workspaceId || null,
        kind: candidate.kind || 'fact',
        content: candidate.content,
        headline: candidate.content.slice(0, 500),
        topic: candidate.topic || 'general',
        topics: [candidate.topic || 'general'],
        entities: candidate.entities || [],
        confidence: Number(candidate.confidence) || 0,
        evidence: candidate.evidence || [],
        source: candidate.source || 'auto',
        operator: {userCode: operator?.userCode || userCode, realName: operator?.realName || ''},
    }

    if (decision.action === 'merge') {
        const target = atoms.find(a => a.atomCode === decision.targetCode)
        const mergedEvidence = [...new Set([...(target?.evidence || []), ...(candidate.evidence || [])].map(_ => _.eventCode))]
            .map(eventCode => ({eventCode, quote: null}))
        await memoryAtomDac.update({evidence: mergedEvidence}, {atomCode: decision.targetCode})
        await memoryCandidateDac.add({
            userCode, channel, workspaceId: workspaceId || null, eventCodes: candidate.eventCodes,
            content: candidate.content, topic: candidate.topic, kind: candidate.kind,
            confidence: candidate.confidence, evidence: candidate.evidence,
            state: MemoryStatusEnum.superseded.value, atomCode: decision.targetCode,
            rejectReason: 'duplicate_content', source: candidate.source || 'auto',
            operator: baseDoc.operator,
        })
        await journal({
            userCode, channel, actor: 'promoter', op: 'merge', targetType: 'atom', targetCode: decision.targetCode,
            after: {evidenceCount: mergedEvidence.length}, reason: decision.reason, operator,
        })
        return {action: 'merge', atomCode: decision.targetCode}
    }

    if (decision.action === 'supersede') {
        const target = atoms.find(a => a.atomCode === decision.targetCode)
        await memoryAtomDac.update({state: MemoryStatusEnum.retired.value}, {atomCode: decision.targetCode})
        /** 原子退役的同时把它的事件证据降级，否则该事实会从归档回退里被重新注入 */
        await retireEvidenceEvents(target, MemoryStatusEnum.superseded.value)
        /** 向量索引里也不能再留着旧说法，否则语义召回仍会把它端上来 */
        await dropFromStore(target || {userCode, channel, workspaceId, atomCode: decision.targetCode})
        /** 替代者先进待审，避免自动判定直接改写用户可见的记忆生效集 */
        const atomCode = tools.getUUID()
        await memoryAtomDac.add({
            ...baseDoc, atomCode,
            state: MemoryStatusEnum.review.value,
            supersededBy: null, mergedFrom: [decision.targetCode],
        })
        await memoryAtomDac.update({supersededBy: atomCode}, {atomCode: decision.targetCode})
        await memoryCandidateDac.add({
            userCode, channel, workspaceId: workspaceId || null, eventCodes: candidate.eventCodes,
            content: candidate.content, topic: candidate.topic, kind: candidate.kind,
            confidence: candidate.confidence, evidence: candidate.evidence,
            state: MemoryStatusEnum.review.value, atomCode,
            rejectReason: decision.reason, source: candidate.source || 'auto', operator: baseDoc.operator,
        })
        await journal({
            userCode, channel, actor: 'promoter', op: 'supersede', targetType: 'atom', targetCode: decision.targetCode,
            before: {state: MemoryStatusEnum.active.value, content: target?.content},
            after: {state: MemoryStatusEnum.retired.value, replacedBy: atomCode},
            evidence: candidate.evidence, reason: decision.reason, operator,
        })
        await journal({
            userCode, channel, actor: 'promoter', op: 'create', targetType: 'atom', targetCode: atomCode,
            after: {state: MemoryStatusEnum.review.value, content: candidate.content},
            evidence: candidate.evidence, reason: 'supersedes_conflict', operator,
        })
        return {action: 'supersede', atomCode}
    }

    if (decision.action === 'review' || decision.action === 'reject') {
        await memoryCandidateDac.add({
            userCode, channel, workspaceId: workspaceId || null, eventCodes: candidate.eventCodes,
            content: candidate.content, topic: candidate.topic, kind: candidate.kind,
            confidence: candidate.confidence, evidence: candidate.evidence,
            state: decision.action === 'reject' ? MemoryStatusEnum.retired.value : MemoryStatusEnum.review.value,
            rejectReason: decision.reason, source: candidate.source || 'auto', operator: baseDoc.operator,
        })
        if (decision.action === 'reject') {
            await journal({
                userCode, channel, actor: 'promoter', op: 'drop', targetType: 'candidate',
                targetCode: null, reason: decision.reason, operator,
            })
        }
        return {action: decision.action, atomCode: null, reason: decision.reason}
    }

    /** promote：新原子直接生效（显式保存与高置信自动抽取都走这里） */
    const atomCode = tools.getUUID()
    const state = (candidate.source === 'auto' && (candidate.confidence ?? 0) < (config.memory?.promotion?.autoMinConfidence ?? 0.6))
        ? MemoryStatusEnum.review.value : MemoryStatusEnum.active.value
    const indexedAt = await syncToStore({...baseDoc, atomCode})
    await memoryAtomDac.add({...baseDoc, atomCode, state, indexedAt})
    await memoryCandidateDac.add({
        userCode, channel, workspaceId: workspaceId || null, eventCodes: candidate.eventCodes,
        content: candidate.content, topic: candidate.topic, kind: candidate.kind,
        confidence: candidate.confidence, evidence: candidate.evidence,
        state: state === MemoryStatusEnum.active.value ? MemoryStatusEnum.active.value : MemoryStatusEnum.review.value,
        atomCode, source: candidate.source || 'auto', operator: baseDoc.operator,
    })
    await journal({
        userCode, channel, actor: candidate.source === 'user_save' ? 'user' : 'promoter',
        op: 'create', targetType: 'atom', targetCode: atomCode,
        after: {state, content: candidate.content, confidence: candidate.confidence},
        evidence: candidate.evidence, reason: decision.reason, operator,
    })
    await bumpEntities({candidate, atomCode, userCode, channel, operator})
    try {
        await memoryNamespaceDac.update(
            {atomCount: ((ns?.atomCount || 0) + (state === MemoryStatusEnum.active.value ? 1 : 0)), lastActiveAt: new Date()},
            {userCode, channel, workspaceId: workspaceId || null}
        )
    } catch (e) {
        logger.warn(`更新记忆命名空间计数失败(${userCode}/${channel}): ${e.message}`)
    }
    return {action: 'promote', atomCode, state}
}

/**
 * @description 处理一个抽取任务：回查事件、跑抽取、逐条晋升
 * @author xianyang
 * @param {Object} job 任务
 * @returns {Promise<Object>} 处理统计
 */
export async function processExtractJob(job) {
    const {userCode, channel, workspaceId = null, eventCodes = []} = job
    if (!userCode || !channel || !eventCodes.length) {
        return {skipped: true, reason: 'bad_job'}
    }
    const events = await memoryEventDac.getTop(eventCodes.length, {eventCodes, userCode, channel}, {insertTime: 1})
    if (!events?.length) {
        return {skipped: true, reason: 'no_events'}
    }
    const operator = {userCode, realName: events[0]?.operator?.realName || ''}
    const {extractCandidates} = await import('./extractor.js')
    const extracted = await extractCandidates({events, channel})
    const existing = await loadActiveAtoms({userCode, channel, workspaceId})
    const results = []
    for (const candidate of extracted.candidates) {
        results.push(await promoteCandidate({
            candidate: {...candidate, insertTime: Date.now()},
            userCode, channel, workspaceId, operator, existing,
        }))
        /** 本批次新生效的原子要立刻进入后续比对集，否则同批内的重复会被全部放行 */
        const fresh = await loadActiveAtoms({userCode, channel, workspaceId})
        existing.length = 0
        existing.push(...fresh)
    }
    /** BaseDac.update 的第二参是原始 Mongo 条件，不走 dac 的字段映射 */
    await memoryEventDac.update(
        {state: MemoryStatusEnum.active.value},
        {eventCode: {$in: eventCodes}},
    ).catch(e => logger.warn(`回写记忆事件状态失败(${userCode}/${channel}): ${e.message}`))
    return {
        model: extracted.model,
        attempts: extracted.attempts,
        produced: extracted.candidates.length,
        rejected: extracted.rejected,
        actions: results.map(_ => _.action),
    }
}

/**
 * @description 把不再生效的原子从向量索引里摘掉。
 * 删除失败只是多留一条不会再被注入的索引项（召回会回权威库校验状态），不打断晋升。
 * @author xianyang
 * @param {Object} atom 原子
 * @returns {Promise<Number>} 删除条数
 */
export async function dropFromStore(atom) {
    try {
        const store = await getMemoryStore()
        if (!store.capabilities?.has?.('semantic') || typeof store.remove !== 'function') {
            return 0
        }
        const ret = await store.remove({
            userCode: atom?.userCode,
            channel: atom?.channel,
            workspaceId: atom?.workspaceId,
            atomCodes: [atom?.atomCode].filter(Boolean),
            operator: atom?.operator,
        })
        return ret?.deleted ?? 0
    } catch (e) {
        logger.warn(`记忆向量删除失败(${atom?.atomCode})，留给压实补删: ${e.message}`)
        return 0
    }
}
