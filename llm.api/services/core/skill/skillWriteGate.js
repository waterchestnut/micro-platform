/**
 * @fileOverview skill 写面幂等闸的接线层（llmChat 工具循环的 other 段调用）
 * @module services/core/skill/skillWriteGate
 * @description
 * 判据全在 `skillWriteIdempotency.js`（纯表），账在全在 dac——这里只做编排：
 * 查账 → 决策 → （claim → 执行 → settle）。deps 注入纪律同 recoverCandidate：
 * 单测给 fake 三件套（lookup/claim/settle）真跑全分支，e2e 走真 dac。
 *
 * 两条逐字不变的红线：
 * 1. 闸关 ⇒ llmChat 连本模块都不 import（接线点懒 import，纪律同 globalRunGate/artifact）；
 * 2. 非写面/无键 ⇒ 行为与旧批量执行**同序同形**：顺序执行、逐条结果、错误包装原样。
 *    （旧执行面本来就是 toolManager/skillChat 内部 for-await 串行，这里改 per-call 不引入新并发。）
 *
 * started 行是刻意保留的"危险化石"：执行 throw ⇒ 不 settle ⇒ 行停在 started ⇒
 * 未来重放 refuse——副作用状态未知时宁可 refuse 也不许双跑，这正是 B-4 要的保险。
 */
import {buildSkillWriteKey, decideSkillWriteGate, clipSnapshot, WRITE_STARTED_MSG} from './skillWriteIdempotency.js'

/** llm.logger 可能缺席（单测不跑 init）——取法与 artifact/intakeWiring 同形，console 兜底 */
const logger = (typeof llm !== 'undefined' && llm.logger) || console

/**
 * 对 calls 逐条过闸执行。
 * @param {Object} params
 * @param {Array<Object>} params.calls toolCall 数组（OpenAI 形状）
 * @param {String} params.runCode run 标识（llmChat=messageCode）
 * @param {Object} params.cfg {enabled, writeTools, snapshotMaxChars}
 * @param {Function} params.execOne 单条执行器：(toolCall)=>Promise<Array>（返回单元素结果数组，
 *   形状=旧 executeToolCalls/executeSkillToolCalls 的产出条目）
 * @param {Object} [params.deps] 注账三件套 {lookup, claim, settle}（缺省=真 dac，懒 import）
 * @param {Object} [params.context] {conversationCode, userCode}（记账定位用）
 * @returns {Promise<Array>} 与 calls 同序的 tool 消息数组
 */
export async function runToolCallsWithWriteGate({calls = [], runCode = '', cfg = {}, execOne, deps, context = {}} = {}) {
    if (typeof execOne !== 'function') {
        throw new Error('skillWriteGate: execOne 必填（接线漂移比闸门失效更糟——宁可抛出去让上层如实报错）')
    }
    /** 执行一条并保持旧错误包装：execOne throw（调用方形状漂移）时不许炸整批。
     *  threw 必须带回来：execute 档 catch 出来的错误内容**不许 settle**——执行没完成，
     *  把"没干完"记成 done 会让未来重放拿到假快照（比 started 更坏：保险被污染成自信）。 */
    async function execOneSafe(tc) {
        try {
            const r = await execOne(tc)
            return {results: Array.isArray(r) ? r : [r], threw: false}
        } catch (e) {
            logger.error(`skill 写面闸执行异常(包装回模型): tool=${tc?.function?.name} ${String(e?.message || e).slice(0, 200)}`)
            return {results: [buildToolMessage(tc, JSON.stringify({
                success: false, error: String(e?.message || e).slice(0, 500), tool: tc?.function?.name || '',
            }))], threw: true}
        }
    }
    const d = deps || (await import('../../../daos/core/dac/skillWriteJournalDac.js')).default
    const results = []
    for (const toolCall of calls) {
        const toolName = toolCall?.function?.name || ''
        const key = buildSkillWriteKey({runCode, toolCallId: toolCall?.id || ''})
        /** 第一段：不碰账就能定性的档位（闸关/名单外/无键）——passthrough 一条查询都不发，
         *  读面工具不付账查询的钱（与 M5"普通消息 no-prev 不付计数"同一纪律） */
        const first = decideSkillWriteGate({enabled: cfg.enabled, toolName, writeTools: cfg.writeTools || [], key})
        if (first.action === 'passthrough') {
            results.push(...(await execOneSafe(toolCall)).results)
            continue
        }
        /** 第二段：确认要过保险面了才读账。快路径=lookup；读失败不拦执行
         *  （"读不到"≠"不存在"）——claim 才是并发终裁，读挂了顶多多一次往返 */
        let existing = null
        try {
            existing = await d.lookup(key)
        } catch (e) {
            logger.warn(`skill 写面闸读账失败(继续走 claim 终裁): key=${key || '-'} ${String(e?.message || e).slice(0, 160)}`)
        }
        const decision = decideSkillWriteGate({
            enabled: cfg.enabled, toolName, writeTools: cfg.writeTools || [], key, existing,
        })
        if (decision.action === 'replay') {
            logger.warn(`skill 写面重放命中(未执行): key=${key}, tool=${toolName}`)
            results.push(buildToolMessage(toolCall, decision.snapshot))
            continue
        }
        if (decision.action === 'refuse') {
            logger.warn(`skill 写面拒绝重跑(保险面): key=${key}, tool=${toolName}, reason=${decision.reason}`)
            results.push(buildToolMessage(toolCall, JSON.stringify({
                success: false, error: WRITE_STARTED_MSG, tool: toolName, idempotency: decision.reason,
            })))
            continue
        }
        // execute 档：claim 是并发终裁
        let claimed = null
        try {
            claimed = await d.claim({
                key, runCode, toolCallId: toolCall?.id || '', toolName,
                conversationCode: context.conversationCode || '', userCode: context.userCode || '',
            })
        } catch (e) {
            /** 账写不进去 ⇒ 保险不存在，绝不执行（宁可不干，不可双干）；如实回错误 */
            logger.error(`skill 写面 claim 失败，本轮不执行: key=${key} ${String(e?.message || e).slice(0, 160)}`)
            results.push(buildToolMessage(toolCall, JSON.stringify({
                success: false, error: '写面幂等账不可写，本次未执行（请稍后重试或联系管理员）', tool: toolName, idempotency: 'claim-failed',
            })))
            continue
        }
        if (claimed) {
            // 行已存在：按旧行状态走 replay/refuse（claim 返回 null 才是"我插的"）
            const again = decideSkillWriteGate({enabled: true, toolName, writeTools: cfg.writeTools || [], key, existing: claimed})
            if (again.action === 'replay') {
                results.push(buildToolMessage(toolCall, again.snapshot))
            } else {
                results.push(buildToolMessage(toolCall, JSON.stringify({
                    success: false, error: WRITE_STARTED_MSG, tool: toolName, idempotency: again.reason === 'first-seen' ? 'claim-race' : again.reason,
                })))
            }
            continue
        }
        const {results: execResults, threw} = await execOneSafe(toolCall)
        results.push(...execResults)
        if (threw) {
            /** 执行没完成：行留在 started ⇒ 未来重放 refuse（保守面成立），不许 settle 成自信 */
            continue
        }
        /** settle 失败只 warn：副作用已发生，账停在 started ⇒ 未来重放 refuse（保守面成立）。
         *  把 settle 异常冒成工具错误反而是假话——执行明明完成了。 */
        try {
            const clip = clipSnapshot(execResults[0]?.content, cfg.snapshotMaxChars)
            await d.settle(key, clip)
        } catch (e) {
            logger.warn(`skill 写面 settle 失败(行留 started，重放将 refuse): key=${key} ${String(e?.message || e).slice(0, 160)}`)
        }
    }
    return results
}

/** tool 消息单源形状（与 toolManager/skillChat 的产出同形：tool_call_id/role/content） */
function buildToolMessage(toolCall, content) {
    return {tool_call_id: toolCall?.id || '', role: 'tool', content: String(content ?? '')}
}

export default {runToolCallsWithWriteGate}
