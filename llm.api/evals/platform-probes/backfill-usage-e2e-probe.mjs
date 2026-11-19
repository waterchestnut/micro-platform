/**
 * @fileOverview 回填 usage 快照端到端取证（PR-任务编排 M6 边角闭环）
 * @module evals/platform-probes/backfill-usage-e2e-probe
 * @description
 * 真库真写（不动 cron 开关，直调 backfillAbandonedRuns）：
 *   B1 有真值的遗弃行 ⇒ 回填 message 档带 extInfo.usage{hasUsage:true, tokens/credits 照抄}
 *      （视图 messageView 读同一键——写读对上才算前端可见，不是只进库的哑数据）；
 *   B2 死在首 token 前的行 ⇒ extInfo.usage={hasUsage:false,...}（三端"开始输出前已取消"归因的凭据）；
 *   B3 llmUsage 行被认领翻 abort（回填主链没被本刀改坏）；
 *   C1 按 messageCode 清尽。
 * **防误伤**：listAbandoned 是全局扫描（olderThanMs+limit），真跑会把 dev 库其他遗弃行一起回填——
 * 所以 dacs.usage 注入"只返回本探针两行"的壳（claimAbandoned 等其余方法仍走真 dac），
 * 写档/读档全真。这是"真 e2e 不等于对共享库开火"的配方。
 * 用法：node evals/platform-probes/backfill-usage-e2e-probe.mjs
 */
await import('../../init.js')
const {LlmUsage, Message} = await import('../../daos/core/schema/index.js')
const llmUsageDac = (await import('../../daos/core/dac/llmUsageDac.js')).default
const messageDac = (await import('../../daos/core/dac/messageDac.js')).default
const {backfillAbandonedRuns} = await import('../../services/core/session/abandonedBackfill.js')

const V = {}
const out = {}
const EXPECTED = 4
const ts = Date.now()
const conv = `bfu-${ts}`
const mA = `bfu-a-${ts}`
const mB = `bfu-b-${ts}`
const old = new Date(Date.now() - 30 * 60 * 1000)

try {
    // 两行遗弃账本：A 有真值（在途刷新写过的形状），B 死在首 token 前（tokens 全 0）
    await LlmUsage.create({
        messageCode: mA, conversationCode: conv, userCode: 'menglb', channel: 'micro_common',
        progress: 'processing', insertTime: old, updateTime: old,
        modelCalls: 2, estPromptTokens: 500, promptTokens: 900, completionTokens: 100, totalTokens: 1000,
        credits: 1000, creditsPriced: false,
    })
    await LlmUsage.create({
        messageCode: mB, conversationCode: conv, userCode: 'menglb', channel: 'micro_common',
        progress: 'processing', insertTime: old, updateTime: old, modelCalls: 1, estPromptTokens: 800,
    })

    // 注入壳：扫描只见本探针两行（按真投影取回），其余方法（claimAbandoned）全真。
    // Object.create 而非 {...dac}——dac 的方法在**原型**上，展开只剩自有属性
    //（claimAbandoned is not a function 之训，probe 也是代码）。
    const REAL_FIELDS = ['messageCode', 'conversationCode', 'userCode', 'progress', 'updateTime', 'modelCalls',
        'estPromptTokens', 'promptTokens', 'completionTokens', 'totalTokens', 'credits', 'creditsPriced'].reduce((a, k) => ({...a, [k]: 1}), {})
    const usageDac = Object.create(llmUsageDac)
    usageDac.listAbandoned = async () => LlmUsage.collection.find({messageCode: {$in: [mA, mB]}}).project(REAL_FIELDS).toArray()
    const ret = await backfillAbandonedRuns({dryRun: false, olderThanMs: 10 * 60 * 1000, limit: 10, dacs: {usage: usageDac, message: messageDac}})
    out.run = {planned: ret.planned, backfilled: ret.backfilled.length, skipped: ret.skipped}

    const rowA = await Message.collection.findOne({messageCode: mA}, {projection: {progress: 1, error: 1, extInfo: 1}})
    const rowB = await Message.collection.findOne({messageCode: mB}, {projection: {extInfo: 1}})
    out.A = rowA && {progress: rowA.progress, usage: rowA.extInfo?.usage, writtenBy: rowA.extInfo?.writtenBy, lostChars: rowA.extInfo?.lostChars}
    out.B = rowB && {usage: rowB.extInfo?.usage}

    V['B1 有真值 ⇒ 回填档 extInfo.usage 原样带 tokens/credits（priced:false 不丢）'] = !!rowA
        && rowA.progress === 'abort' && rowA.extInfo?.writtenBy === 'backfill'
        && rowA.extInfo?.usage?.hasUsage === true
        && rowA.extInfo.usage.promptTokens === 900 && rowA.extInfo.usage.completionTokens === 100
        && rowA.extInfo.usage.totalTokens === 1000 && rowA.extInfo.usage.credits === 1000
        && rowA.extInfo.usage.creditsPriced === false && rowA.extInfo.usage.modelCalls === 2
    V['B2 死在首 token 前 ⇒ {hasUsage:false}（精确归因的凭据，不是空键落回笼统句）'] = !!rowB
        && rowB.extInfo?.usage?.hasUsage === false && !('promptTokens' in (rowB.extInfo.usage || {}))
        && rowB.extInfo?.usage?.modelCalls === 1
    const ledgerA = await LlmUsage.collection.findOne({messageCode: mA}, {projection: {progress: 1}})
    const ledgerB = await LlmUsage.collection.findOne({messageCode: mB}, {projection: {progress: 1}})
    V['B3 认领链未坏（llmUsage 两行 processing→abort）'] = ledgerA?.progress === 'abort' && ledgerB?.progress === 'abort'
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    try {
        await Message.collection.deleteMany({messageCode: {$in: [mA, mB]}})
        await LlmUsage.collection.deleteMany({messageCode: {$in: [mA, mB]}})
        const residual = await Message.collection.countDocuments({messageCode: {$in: [mA, mB]}})
            + await LlmUsage.collection.countDocuments({messageCode: {$in: [mA, mB]}})
        out.residual = residual
        if (!out.错误) V['C1 两表按 messageCode 清尽(residual=0)'] = residual === 0
    } catch (e) { out.cleanupError = String(e?.message || e).slice(0, 200) }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '回填 usage 快照 e2e 通过(真值照抄/hasUsage:false/认领链/清尽)' : '未通(见 false 项)'
console.log('\n==== BACKFILL-USAGE E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
