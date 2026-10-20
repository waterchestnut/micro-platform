/**
 * @fileOverview 记忆对外接口层
 * @module services/core/memory/api
 * @description 所有读写都以 curUserInfo.userCode 为边界：只能看和改自己的记忆。
 */

import memoryAtomDac from '../../../daos/core/dac/memoryAtomDac.js'
import memoryEventDac from '../../../daos/core/dac/memoryEventDac.js'
import memoryJournalDac from '../../../daos/core/dac/memoryJournalDac.js'
import memoryProfileDac from '../../../daos/core/dac/memoryProfileDac.js'
import MemoryStatusEnum from '../../../daos/core/enum/MemoryStatusEnum.js'
import {toMessageView} from '../message.js'
import {recallForPrompt, parseQuery} from './recall.js'
import {saveExplicit} from './capture.js'
import {retireEvidenceEvents} from './promote.js'
import {getChannelMemory} from '../../../conf/llmChannel.js'
import {getTokenizerOptions, TOKENIZER_VERSION} from '../../openai/util.js'
import {md5} from '../../../tools/security.js'

const tools = llm.tools
const config = llm.config

/** owner 文档单份上限，避免有人把它当存储用 */
const DOC_MAX_CHARS = 20000

function assertChannel(curUserInfo, channel) {
    if (!curUserInfo?.userCode) {
        /** 与 /core/chat/stream 一致：身份缺失是客户端错误，不能让下游抛 TypeError */
        const err = new Error('缺少有效的用户身份（user-info）')
        err.statusCode = 401
        throw err
    }
    if (!channel) {
        const err = new Error('channel 不能为空')
        err.statusCode = 400
        throw err
    }
    const cm = getChannelMemory(channel)
    if (!cm.enabled && !cm.recall && !cm.capture) {
        const err = new Error(`频道 ${channel} 未开启记忆`)
        err.statusCode = 403
        throw err
    }
    return cm
}

/**
 * @description 列出记忆原子
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {Object} filter 筛选
 * @param {Number} pageIndex 页码
 * @param {Number} pageSize 每页
 * @param {Object} options 排序等
 * @returns {Promise<Object>} 分页结果
 */
export async function listAtoms(curUserInfo, filter = {}, pageIndex = 1, pageSize = 20, options = {}) {
    assertChannel(curUserInfo, filter.channel)
    const states = Array.isArray(filter.states) && filter.states.length ? filter.states : [MemoryStatusEnum.active.value]
    const ret = await memoryAtomDac.getByPage(pageIndex, pageSize, {
        userCode: curUserInfo.userCode,
        channel: filter.channel,
        workspaceId: filter.workspaceId || null,
        states,
        topic: filter.topic,
        kind: filter.kind,
        content: filter.keyword,
        sort: options.sort || {confidence: -1, updateTime: -1},
        ...(options.total ? {total: options.total} : {}),
    })
    return {
        total: ret.total,
        rows: (ret.rows || []).map(a => ({
            atomCode: a.atomCode, kind: a.kind, topic: a.topic, content: a.content,
            confidence: a.confidence, source: a.source, state: a.state,
            evidenceCount: (a.evidence || []).length,
            entities: (a.entities || []).map(e => e.name).filter(Boolean),
            insertTime: a.insertTime, updateTime: a.updateTime,
        })),
    }
}

/**
 * @description 取一条记忆全文与证据
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} atomCode 记忆标识
 * @param {String} channel 频道
 * @returns {Promise<Object>} 记忆详情
 */
export async function getAtom(curUserInfo, atomCode, channel) {
    assertChannel(curUserInfo, channel)
    const rows = await memoryAtomDac.getTop(1, {atomCode, userCode: curUserInfo.userCode, channel})
    const atom = rows?.[0]
    if (!atom) {
        const err = new Error('记忆不存在')
        err.statusCode = 404
        throw err
    }
    const events = await memoryEventDac.getTop(10, {eventCodes: (atom.evidence || []).map(_ => _.eventCode)}, {insertTime: 1})
    return {
        atomCode: atom.atomCode, kind: atom.kind, topic: atom.topic, content: atom.content,
        confidence: atom.confidence, source: atom.source, state: atom.state,
        supersededBy: atom.supersededBy || null, mergedFrom: atom.mergedFrom || [],
        entities: atom.entities || [], insertTime: atom.insertTime, updateTime: atom.updateTime,
        evidence: (atom.evidence || []).map(ev => {
            const src = (events || []).find(e => e.eventCode === ev.eventCode)
            return {
                eventCode: ev.eventCode, role: src?.role, quote: ev.quote || null,
                content: src?.content || null, conversationCode: src?.conversationCode || null,
                insertTime: src?.insertTime || null,
            }
        }),
    }
}

/**
 * @description 退役一条记忆（软退役，留痕）
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} atomCode 记忆标识
 * @param {String} channel 频道
 * @param {String} [reason] 理由
 * @returns {Promise<Object>} 结果
 */
export async function retireAtom(curUserInfo, atomCode, channel, reason = '') {
    assertChannel(curUserInfo, channel)
    const rows = await memoryAtomDac.getTop(1, {atomCode, userCode: curUserInfo.userCode, channel})
    const atom = rows?.[0]
    if (!atom) {
        const err = new Error('记忆不存在')
        err.statusCode = 404
        throw err
    }
    await memoryAtomDac.update({state: MemoryStatusEnum.retired.value}, {atomCode})
    /** 证据事件一并降级，否则退役内容会从"原始对话回退"里被重新注入 */
    await retireEvidenceEvents(atom, MemoryStatusEnum.retired.value)
    await memoryJournalDac.add({
        userCode: curUserInfo.userCode, channel, actor: 'user', op: 'retire',
        targetType: 'atom', targetCode: atomCode,
        before: {state: atom.state, content: atom.content},
        after: {state: MemoryStatusEnum.retired.value},
        reason: reason || 'user_request',
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
    })
    try {
        const {getMemoryStore} = await import('./store/index.js')
        const store = await getMemoryStore()
        if (store.capabilities?.has?.('semantic')) {
            await store.remove({userCode: curUserInfo.userCode, channel, atomCodes: [atomCode]}).catch(() => null)
        }
    } catch {
        /** 索引清理失败不影响权威库已生效的退役 */
    }
    return {atomCode, retired: true}
}

/**
 * @description 手动保存一条记忆
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {Object} params 入参
 * @returns {Promise<Object>} 结果
 */
export async function saveMemory(curUserInfo, {channel, content, topic = 'general', conversationCode, messageCode} = {}) {
    assertChannel(curUserInfo, channel)
    if (typeof content !== 'string' || !content.trim()) {
        const err = new Error('content 不能为空')
        err.statusCode = 400
        throw err
    }
    const ret = await saveExplicit({
        curUserInfo, channel, content: content.trim(), topic, conversationCode, messageCode,
    })
    if (!ret?.ok) {
        const err = new Error(ret?.reason || '保存失败')
        err.statusCode = 400
        throw err
    }
    return {atomCode: ret.atomCode, action: ret.action}
}

/**
 * @description 读 owner 文档
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} channel 频道
 * @returns {Promise<Object>} 文档
 */
export async function getProfile(curUserInfo, channel) {
    assertChannel(curUserInfo, channel)
    const doc = await memoryProfileDac.getByNamespace(curUserInfo.userCode, channel)
    return {
        channel,
        userDoc: doc?.userDoc || '',
        memoryDoc: doc?.memoryDoc || '',
        docVersion: doc?.docVersion || 0,
        docHash: doc?.docHash || null,
        updatedBy: doc?.updatedBy || null,
        updateTime: doc?.updateTime || null,
    }
}

/**
 * @description 改写 owner 文档：只允许本人，版本号递增便于会话内快照失效判断
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {Object} params 入参
 * @returns {Promise<Object>} 结果
 */
export async function updateProfile(curUserInfo, {channel, userDoc, memoryDoc} = {}) {
    assertChannel(curUserInfo, channel)
    const clamp = (v, label) => {
        if (v === undefined || v === null) {
            return undefined
        }
        if (typeof v !== 'string') {
            const err = new Error(`${label} 必须是字符串`)
            err.statusCode = 400
            throw err
        }
        if (v.length > DOC_MAX_CHARS) {
            const err = new Error(`${label} 超过 ${DOC_MAX_CHARS} 字上限`)
            err.statusCode = 400
            throw err
        }
        return v
    }
    const nextUser = clamp(userDoc, 'userDoc')
    const nextMemory = clamp(memoryDoc, 'memoryDoc')

    const exist = await memoryProfileDac.getByNamespace(curUserInfo.userCode, channel)
    const mergedUser = nextUser ?? (exist?.userDoc || '')
    const mergedMemory = nextMemory ?? (exist?.memoryDoc || '')
    const docHash = md5(`${mergedUser}
${mergedMemory}`)
    const patch = {
        userCode: curUserInfo.userCode,
        channel,
        workspaceId: null,
        userDoc: mergedUser,
        memoryDoc: mergedMemory,
        docVersion: (exist?.docVersion || 0) + 1,
        docHash,
        updatedBy: curUserInfo.userCode,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
    }
    await memoryProfileDac.upsert(patch, {userCode: curUserInfo.userCode, channel, workspaceId: null})
    await memoryJournalDac.add({
        userCode: curUserInfo.userCode, channel, actor: 'user', op: 'edit', targetType: 'profile',
        targetCode: `${curUserInfo.userCode}|${channel}`,
        before: exist ? {userDoc: exist.userDoc, memoryDoc: exist.memoryDoc, docVersion: exist.docVersion} : null,
        after: {userDoc: mergedUser, memoryDoc: mergedMemory, docVersion: patch.docVersion},
        reason: 'owner_edit',
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
    })
    return {docVersion: patch.docVersion, docHash}
}

/**
 * @description 检索已归档的对话原文（对应 Memory.search 语义，与事实召回是两套 API）
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {Object} params 入参
 * @returns {Promise<Object>} 分页结果
 */
export async function searchArchive(curUserInfo, {channel, keyword, pageIndex = 1, pageSize = 20, options = {}} = {}) {
    assertChannel(curUserInfo, channel)
    if (!keyword || !String(keyword).trim()) {
        return {total: 0, rows: []}
    }
    const ret = await memoryEventDac.getByPage(pageIndex, pageSize, {
        userCode: curUserInfo.userCode,
        channel,
        content: String(keyword).trim(),
        sort: options.sort || {insertTime: -1},
    })
    return {
        total: ret.total,
        rows: (ret.rows || []).map(e => ({
            eventCode: e.eventCode, role: e.role, content: e.content,
            conversationCode: e.conversationCode, messageCode: e.messageCode,
            tokens: e.tokens, insertTime: e.insertTime,
        })),
    }
}

/**
 * @description 召回预览：把管线各阶段中间结果吐出来，便于调试与验收
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {Object} params 入参
 * @returns {Promise<Object>} 各阶段明细
 */
export async function recallPreview(curUserInfo, {channel, query, workspaceId = null} = {}) {
    assertChannel(curUserInfo, channel)
    if (!query || !String(query).trim()) {
        const err = new Error('query 不能为空')
        err.statusCode = 400
        throw err
    }
    const llmModel = config.context?.previewModel || 'relay_common_pro'
    const tokenizerOptions = getTokenizerOptions(config.models?.[llmModel])
    const terms = parseQuery(query)
    const ret = await recallForPrompt({
        userCode: curUserInfo.userCode, channel, workspaceId, query,
        tokenizerOptions,
    })
    return {
        query, channel, terms,
        tokenizerVersion: TOKENIZER_VERSION,
        fromCache: !!ret.fromCache,
        stats: ret.stats,
        items: ret.items.map(i => ({
            atomCode: i.atomCode, content: i.content, topic: i.topic,
            source: i.source, confidence: i.confidence, score: Number(i.score ?? 0).toFixed(4),
        })),
        rendered: ret.text,
    }
}

export {toMessageView}
