/**
 * @fileOverview 遗弃 run 的回填（损失可见化的最后一段）
 * @module services/core/session/abandonedBackfill
 * @description
 * 处理的是这样一种行：`llmUsage` 还写着 `processing`，`message` 里却一行都没有。
 * 用户侧的表现是"这一轮从未发生过"——这正是 P-10 长期拿不到现场证据的原因（§25 v1.33/v1.34）。
 *
 * 与 PR-E0.5 主动落档的分工：
 * - 主动落档（`closeWithRescue` + `archiveAllInflight`）救的是**还活着的进程里**的 run，能带走正文；
 * - 本模块兜的是**已经来不及做任何事**的 run：SIGKILL、OOM、节点被驱逐。
 *   实测这类行的正文可救回 0/5、问题可救回 5/5（`abandoned-recoverable-content.mjs`），
 *   所以这里**只回填"你当时问了什么 + 这一轮被中断"**，绝不假装能恢复回答。
 *
 * 两条硬规矩：
 * 1. **先认领再写档**。用 `findOneAndUpdate({messageCode, progress:'processing'} → {progress:'abort'})`
 *    做原子认领，只有 `modifiedCount===1` 的那个进程才写档案。
 *    反过来（先写档再改状态）在两个 pod 同时扫时会写出两条同 messageCode 的档案——
 *    而重复档案会同时污染历史与记忆采集（`llmChat` 里那条"重复落库直接拒绝"的注释就是同一教训）。
 *    代价要写明：如果认领后、写档前进程崩了，这条就变成"账本 abort、档案没有"。
 *    窗口是毫秒级，且失败会留下 `messageCode` 便于人工补，比写重复行的后果轻。
 * 2. **已有档案的行绝不认领也不写**：那是真人的数据，被覆盖的损失比"看不见一次损失"大得多。
 */
/**
 * 纯决策层**不在模块顶层 import 任何 dac**：dac 依赖 app 注入的全局 `llm`，
 * 顶层引它们会让 `planBackfill` 这类纯函数在离线单测里直接 `ReferenceError: llm is not defined`。
 * 需要真依赖时由 `backfillAbandonedRuns` 动态 import（测试一律注入 `dacs`，根本不走到这条路）。
 * 同一原则见 `llmLoop.js` 文件头。
 */
import {abandonedQuery, DEFAULT_OLDER_THAN_MS, isAbandonedRun} from '../../../daos/core/policy/llmUsagePolicy.js'
import {shutdownArchiveDecision} from './shutdownPolicy.js'

/** 回填行的标记：审计时要把"服务端当场落的档"和"事后补的档"分开 */
export const BACKFILL_MARKER = 'abandoned-backfill'

/**
 * @description 从检查点里把"用户当时问了什么"捞回来（纯函数，可离线测）
 * @param {Array<Object>} checkpoints 该会话的检查点列表（按 seq 升序）
 * @returns {{query: String, hasAny: Boolean}} 结果
 *
 * 取数口径：`preCreate` 的 `messages` 里最后一条 user 消息。
 * 为什么不能直接读 `llmUsage`：账本没有 query 列——它是窄表，刻意不存用户内容（§14）。
 */
export function recoverQueryFromCheckpoints(checkpoints = []) {
    for (const cp of [...checkpoints].reverse()) {
        const msgs = Array.isArray(cp?.messages) ? cp.messages : []
        for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i]
            if (m?.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
                return {query: m.content, hasAny: true}
            }
        }
    }
    return {query: '', hasAny: false}
}

/**
 * @description 判断一条账本行该怎么处理（不写任何东西）
 * @param {Object} params 参数
 * @param {Object} params.row llmUsage 行
 * @param {Boolean} params.hasArchive 该 messageCode 是否已有档案
 * @param {Object} [params.checkpoint] 该会话最新的检查点（用于捞问题）
 * @param {Number} [params.olderThanMs] 遗弃判定的心跳阈值
 * @param {Function} [params.now] 时间源
 * @returns {{action: 'skip'|'backfill', reason: String, fields: Object|null}} 决策
 */
export function planBackfill({row, hasArchive = false, checkpoint = null, olderThanMs = DEFAULT_OLDER_THAN_MS, now = Date.now} = {}) {
    if (!row?.messageCode) {
        return {action: 'skip', reason: 'no-message-code', fields: null}
    }
    if (hasArchive) {
        /** 有档案就不动：回填是给"看不见损失"兜底的，不是给已有数据做覆盖的 */
        return {action: 'skip', reason: 'archive-exists', fields: null}
    }
    if (!isAbandonedRun({progress: row.progress, updateTime: row.updateTime, olderThanMs, now})) {
        return {action: 'skip', reason: 'heartbeat-fresh', fields: null}
    }
    const {query} = recoverQueryFromCheckpoints(checkpoint ? [checkpoint] : [])
    /**
     * 正文一律为空：这类 run 的检查点只落在阶段边界，`answer` 从来没写进去过
     * （实测正文可救回 0/5）。**没有正文不等于没有价值**——问题 + "被中断"本身就是损失可见化，
     * 而 `progress:'abort'` 是三端都已经能正确渲染的形态（零前端改动，见 §25 v1.34）。
     */
    const fields = {
        messageCode: row.messageCode,
        conversationCode: row.conversationCode,
        query,
        answer: '',
        progress: 'abort',
        error: 'abandoned:process-lost',
        operator: {userCode: row.userCode || '', realName: ''},
        extInfo: {
            interruptedBy: 'process-lost',
            recoveredBy: BACKFILL_MARKER,
            /** 留量级而不是留正文：让人能判断这条损失有多大 */
            lostChars: 0,
            modelCalls: row.modelCalls || 0,
            estPromptTokens: row.estPromptTokens || 0,
        },
    }
    /** 复用主动落档那套"值不值得写"的判据：没正文也不空转——这里问题就是内容 */
    const decision = shutdownArchiveDecision({answerChars: 0, persisted: false})
    return {action: 'backfill', reason: decision.reason === 'no-content' ? 'question-only' : decision.reason, fields}
}

/**
 * @description 执行一次回填扫描
 * @param {Object} [params] 参数
 * @param {Boolean} [params.dryRun] 只出计划不写库（默认 **true**：写库是改用户可见数据）
 * @param {Number} [params.olderThanMs] 心跳阈值
 * @param {Number} [params.limit] 单次处理条数
 * @param {Function} [params.now] 时间源
 * @param {Object} [params.dacs] 依赖注入（测试用）
 * @returns {Promise<{planned: Number, backfilled: Array, skipped: Array, reason: String}>} 结果
 */
export async function backfillAbandonedRuns({
    dryRun = true,
    olderThanMs = DEFAULT_OLDER_THAN_MS,
    limit = 200,
    now = Date.now,
    dacs = {},
} = {}) {
    let usage = dacs.usage
    let message = dacs.message
    let cp = dacs.checkpoint
    if (!usage || !message || !cp) {
        const m1 = await import('../../../daos/core/dac/llmUsageDac.js')
        const m2 = await import('../../../daos/core/dac/messageDac.js')
        const m3 = await import('../../../daos/core/dac/sessionCheckpointDac.js')
        usage = usage || m1.default
        message = message || m2.default
        cp = cp || m3.default
    }
    const rows = await usage.listAbandoned({olderThanMs, limit, now})
    const skipped = []
    const backfilled = []
    for (const row of rows) {
        /** BaseDac.getByCode 的第二个参数**就是投影**（不是 options 对象），写错形状会拿到整个文档 */
        const existing = await message.getByCode(row.messageCode, {_id: 1})
        const checkpoints = await cp.listByConversation(row.conversationCode, 1)
        const plan = planBackfill({
            row,
            hasArchive: Boolean(existing),
            checkpoint: checkpoints?.[0] || null,
            olderThanMs,
            now,
        })
        if (plan.action === 'skip') {
            skipped.push({messageCode: row.messageCode, reason: plan.reason})
            continue
        }
        if (dryRun) {
            backfilled.push({messageCode: row.messageCode, dryRun: true, queryChars: (plan.fields.query || '').length, reason: plan.reason})
            continue
        }
        /**
         * 原子认领：只有把这条从 processing 改成 abort 的进程才继续写档。
         * 判据用 `abandonedQuery` 同一条心跳规则，认领不到说明它已被别人接管或已终态。
         */
        const claimed = await usage.claimAbandoned({messageCode: row.messageCode, olderThanMs, now})
        if (!claimed) {
            skipped.push({messageCode: row.messageCode, reason: 'claim-lost'})
            continue
        }
        try {
            await message.add(plan.fields)
            backfilled.push({messageCode: row.messageCode, dryRun: false, queryChars: (plan.fields.query || '').length, reason: plan.reason})
        } catch (e) {
            /** 认领后写档失败：状态已经变 abort，必须把 messageCode 留在日志里以便人工补 */
            skipped.push({messageCode: row.messageCode, reason: `claimed-but-write-failed:${String(e?.message || e).slice(0, 120)}`})
        }
    }
    return {planned: rows.length, backfilled, skipped, reason: dryRun ? 'dry-run' : 'written'}
}

/**
 * @description 供 dac 之外复用的查询条件（判据只有一份）
 * @param {Object} [params] 参数
 * @param {Number} [params.olderThanMs] 心跳阈值
 * @param {Function} [params.now] 时间源
 * @returns {Object} mongo 查询条件
 */
export function backfillableQuery(params = {}) {
    return abandonedQuery(params)
}
