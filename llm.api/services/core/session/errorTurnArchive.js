/**
 * @fileOverview 未捕获异常的补写档案（P8 处置 ②）
 * @module services/core/session/errorTurnArchive
 * @description
 * 处理的是这一种形状：`execChat` 在**建会话之后、首次落库之前**抛出。
 * 那时有会话、没消息，界面上收到过一条 error 帧，档案里却什么都没有——
 * dev 库实测 126 例（见 docs/ux-process-panel-audit.md 的 P8），AST 探针给出逃逸点下界：
 * 会话创建（157）之后、主保护块（1212）之前有 7 处没有 try 包住的 await。
 *
 * 分工要说清，别和已有机制重叠：
 * - `execChat` 主循环自己的 catch（1636-1647）**已经在写** `progress:'error'` 的档案行，本模块绝不重复；
 * - `abandonedBackfill` 兜的是"进程已经死了、来不及做任何事"，判据是心跳过期，且默认 dry-run；
 * - 本模块只管**当场还活着、只是这一轮抛出去了**的情况：条件很窄——**这一轮一行档案都没落**才补。
 *
 * 为什么补在路由层而不是把主 try 前移：前移会把 1055 行前置逻辑整段圈进一个新的保护块，
 * 而那些抛出各自该记 error / abort / unattributed 又要重新判一轮，判错就是新造一批假归因。
 *
 * 三条硬规矩（都是能被测的形式）：
 * 1. **没建会话就不写**：抛出可能发生在 `conversationDac.add` 之前，那种情况本来就没有残留，
 *    硬写一条挂在不存在会话上的档案反而是我造的脏数据；
 * 2. **已有档案就绝不写**：那一行是真数据，覆盖它比"看不见一次损失"贵得多（与回填第 2 条同源）；
 * 3. **账本收尾用条件更新**：`finalizeIfProcessing` 只认还停在中途的行。
 *    不收尾的后果很具体——账本留着 `processing`，下一轮会被 P5 的 `findOpenRun` 判成
 *    "上一轮还没结束"，于是**一次异常变成了后续每一轮的假重叠**。
 *
 * 纯决策层不在模块顶层 import 任何 dac（同 `abandonedBackfill.js` 文件头那条）：
 * dac 依赖 app 注入的全局 `llm`，顶层引它们会让离线单测直接 ReferenceError。
 */
import {PERSIST_VIA} from './shutdownPolicy.js'
import {cacheIntentForArchive} from './cacheIntent.js'

/** 补写行的标记：审计时要把"当场落的档"与"事后补的档"分开（同回填的 recoveredBy 语义） */
export const ERROR_TURN_MARKER = 'stream-catch'

/** error 文本里异常消息的上限：档案是给人读的，不是堆栈的仓库 */
const MAX_ERROR_CHARS = 300

/**
 * @description 把异常压成一行可核对、可上屏的归因文本
 * @param {Object} [err] 捕获到的异常
 * @returns {String} 形如 `stream-uncaught:TypeError:xxx`
 *
 * 为什么要带名字：库里已有的 error 归因都是 `kind:message` 形态（`abandoned:process-lost`、
 * `${turnErr.kind}:${turnErr.message}`），补写行若只写一句"处理出错"，
 * 就又退回到"界面念得出、数据认不出"的老问题（P6 同源）。
 */
export function errorTurnText(err) {
    /**
     * 消息只从 `message` 取，抛出物本身是字符串时才用它。
     * 这里原来写的是 `err?.message || err`：抛出一个普通对象时会拿到 `[object Object]`——
     * 那不是归因，是一条**看起来像归因**的噪声，而且它非空，会把"没有消息"这个真实事实盖掉。
     */
    const raw = typeof err === 'string' ? err : (err?.message || '')
    const name = String(err?.name || (typeof err === 'string' ? 'ThrownString' : 'Error'))
    const msg = String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_CHARS)
    return `stream-uncaught:${name}:${msg || '(无消息)'}`
}

/**
 * @description 判断这一轮要不要补写档案，并给出那一行的内容（纯函数，不写任何东西）
 * @param {Object} params 参数
 * @param {String} params.messageCode 本轮标识
 * @param {String} params.conversationCode 会话标识
 * @param {Boolean} params.conversationExists 会话记录是否已经建起来
 * @param {Boolean} params.hasArchive 该 messageCode 是否已有档案行
 * @param {String} [params.query] 用户这一轮的问题
 * @param {String} [params.channel] 频道（用路由已有的原始值 + 缺省）
 * @param {String} [params.channelGroup] 频道分组
 * @param {Object} [params.operator] {userCode, realName}
 * @param {Object} [params.err] 捕获到的异常
 * @param {Object} [params.options] 请求 options（只取 cache / channelCacheKey 两个表态）
 * @returns {{action: 'skip'|'write', reason: String, fields: Object|null}} 决策
 */
export function planErrorTurnArchive({
    messageCode = '',
    conversationCode = '',
    conversationExists = false,
    hasArchive = false,
    query = '',
    channel = '',
    channelGroup = '',
    operator = {},
    err = null,
    options = {},
} = {}) {
    if (!messageCode) {
        return {action: 'skip', reason: 'no-message-code', fields: null}
    }
    if (!conversationCode) {
        return {action: 'skip', reason: 'no-conversation-code', fields: null}
    }
    if (hasArchive) {
        /** 已有档案 ⇒ 什么都不动。这条是第 2 号硬规矩，也是最容易被"顺手更新一下"破坏的地方 */
        return {action: 'skip', reason: 'archive-exists', fields: null}
    }
    if (!conversationExists) {
        /** 抛出在建会话之前：那种失败本来就不留残留，不该由我造一行挂在空会话上的档案 */
        return {action: 'skip', reason: 'no-conversation', fields: null}
    }
    const cacheIntent = cacheIntentForArchive(options)
    /**
     * 刻意**不写**的字段，以及为什么不写：
     * - `llmModel`：档位归一发生在 run 里（`pickModelKey`），补写方猜出来的值比空值更坏；
     * - `answer`：正文可能一个字都没有（多数逃逸点在上游调用之前），缓存命中支甚至已经发完了正文——
     *   两种情形都无法在这里区分，所以统一空串 + `lostChars: null`（"不知道"不是"没丢"）；
     * - `messages`/`segments`/`usage`：这些是 run 的产物，没有就是没有，空数组会伪装成"跑过但没产出"。
     */
    return {
        action: 'write',
        reason: 'uncaught-before-archive',
        fields: {
            messageCode,
            conversationCode,
            channel,
            channelGroup,
            query,
            answer: '',
            progress: 'error',
            error: errorTurnText(err),
            operator: {userCode: operator.userCode || '', realName: operator.realName || ''},
            extInfo: {
                writtenBy: PERSIST_VIA.ERROR,
                recoveredBy: ERROR_TURN_MARKER,
                lostChars: null,
                cache: cacheIntent.cache,
                channelCacheKey: cacheIntent.channelCacheKey,
            },
        },
    }
}

/**
 * @description 执行一次补写（读两个存在性、按需写档案、条件收尾账本）
 * @param {Object} params 参数
 * @param {String} params.messageCode 本轮标识
 * @param {String} params.conversationCode 会话标识
 * @param {String} [params.query] 问题
 * @param {Object} [params.options] 请求 options（取 channel / channelGroup / cache / channelCacheKey）
 * @param {Object} [params.userInfo] 当前用户
 * @param {Object} [params.err] 异常
 * @param {String} [params.defaultChannel] 频道缺省值（由调用方给，判据不在这里）
 * @param {String} [params.defaultChannelGroup] 分组缺省值
 * @param {Object} [params.dacs] 依赖注入（测试用）
 * @returns {Promise<Object>} {action, reason, messageCode, ledger}
 *
 * 失败方向：这个函数**不许把异常抛回调用方**。它跑在错误处理路径上，
 * 再抛一次只会让"补档案"变成"多一个没人处理的异常"。所有失败都变成返回值。
 */
export async function archiveUncaughtErrorTurn({
    messageCode = '',
    conversationCode = '',
    query = '',
    options = {},
    userInfo = null,
    err = null,
    defaultChannel = '',
    defaultChannelGroup = '',
    dacs = {},
} = {}) {
    let message = dacs.message
    let usage = dacs.usage
    let conversation = dacs.conversation
    if (!message || !usage || !conversation) {
        const m1 = await import('../../../daos/core/dac/messageDac.js')
        const m2 = await import('../../../daos/core/dac/llmUsageDac.js')
        const m3 = await import('../../../daos/core/dac/conversationDac.js')
        message = message || m1.default
        usage = usage || m2.default
        conversation = conversation || m3.default
    }
    const base = {messageCode, conversationCode}
    try {
        /** BaseDac.getByCode 的第二个参数**就是投影**（不是 options 对象），写错形状会拿到整个文档 */
        const [conversationInfo, existing] = await Promise.all([
            conversationCode ? conversation.getByCode(conversationCode) : null,
            messageCode ? message.getByCode(messageCode, {_id: 1}) : null,
        ])
        const plan = planErrorTurnArchive({
            messageCode,
            conversationCode,
            conversationExists: Boolean(conversationInfo),
            hasArchive: Boolean(existing),
            query,
            channel: options.channel || defaultChannel,
            channelGroup: options.channelGroup || defaultChannelGroup,
            operator: {userCode: userInfo?.userCode, realName: userInfo?.realName},
            err,
            options,
        })
        if (plan.action === 'skip') {
            return {...base, ...plan, ledger: 'not-attempted'}
        }
        await message.add(plan.fields)
        /**
         * 档案写完再收尾账本：反过来的话，中间崩了会留下"账本已终态、档案没有"，
         * 而那恰好是回填扫描的认领条件——等于我主动把这一轮交给了一条会**误归因**（process-lost）的路径。
         */
        const done = await usage.finalizeIfProcessing({
            messageCode,
            progress: 'error',
        })
        return {...base, action: 'written', reason: plan.reason, fields: plan.fields, ledger: done ? 'finalized' : 'not-processing'}
    } catch (e) {
        return {...base, action: 'skip', reason: `failed:${String(e?.name || 'Error')}:${String(e?.message || e).slice(0, 200)}`, fields: null, ledger: 'error'}
    }
}
