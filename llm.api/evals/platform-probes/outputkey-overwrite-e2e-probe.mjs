/**
 * @fileOverview toParentOutputKey 重复完成的落库实证（§4 幂等写回审计，B-3）
 * @module evals/platform-probes/outputkey-overwrite-e2e-probe
 * @description
 * 判据层用例只证明"reduceParentStatus 造不出叠加形状"；写层用例只证明 $set 点路径展开。
 * 这条探针跑**真链路**：真 redlock、真 updateParentAgentTaskWithLock、真库读回原始文档，
 * 钉三件事（设计 §4 的"只覆盖不叠加"要的是这个证据级别）：
 *   O1 同 child 同 key 重复完成 ⇒ 父 handleRet 该键只有一份、值=后写（last-write-wins）；
 *   O2 另一个 child 完成 ⇒ 不踩先写键（点路径互不相干）；
 *   O3 子字段残存（ghost）现状实证：第二轮更小的对象不清旧子键——**入账不改**（改=热路径语义变更，属主拍板另议）；
 *   C1 收尾清尽。
 * 合成码前缀 okov-，只写合成行，跑完显式删。
 * 用法（src/ 下）：node evals/platform-probes/outputkey-overwrite-e2e-probe.mjs
 */
const V = {}
const out = {}
const EXPECTED = 4
const ts = Date.now()
const parentCode = `okov-parent-${ts}`
const childA = `okov-a-${ts}`
const childB = `okov-b-${ts}`

try {
    await import('../../init.js')
    const { addAgentTask, updateParentAgentTaskWithLock } = await import('../../services/core/agentTask.js')
    const { AgentTask } = await import('../../daos/core/schema/index.js')

    await addAgentTask({
        agentCode: parentCode, agentType: 'parallel', agentName: 'okov 父', query: '审计用',
        handleMode: 'manual', conversationCode: `okov-${ts}`,
        operator: { userCode: 'menglb', realName: 'okov' },
        subAgents: [
            { agentCode: childA, toParentOutputKey: 'a', handleStatus: 0, errorMode: 'continue' },
            { agentCode: childB, toParentOutputKey: 'b', handleStatus: 0, errorMode: 'continue' },
        ],
    })
    const raw = async () => AgentTask.collection.findOne({ agentCode: parentCode }, { projection: { handleStatus: 1, handleRet: 1, subAgents: 1 } })

    // 第一轮：child a 完成（带两个子字段）
    await updateParentAgentTaskWithLock(parentCode, { agentCode: childA, toParentOutputKey: 'a', errorMode: 'continue' }, { handleStatus: 2, handleRet: { v: 'first', extra: 2 } }, {})
    // 第二轮：**同 child 同 key 重复完成**，且新对象更小（不带 extra）
    await updateParentAgentTaskWithLock(parentCode, { agentCode: childA, toParentOutputKey: 'a', errorMode: 'continue' }, { handleStatus: 2, handleRet: { v: 'second' } }, {})
    let p = await raw()
    out.dupA = { keys: Object.keys(p?.handleRet || {}), a: p?.handleRet?.a, subN: (p?.subAgents || []).length }
    V['O1 同键重复完成=单键覆盖非叠加（键数与槽位数都不涨，值=后写）'] =
        JSON.stringify(Object.keys(p?.handleRet || {})) === '["a"]'
        && p?.handleRet?.a?.v === 'second' && (p?.subAgents || []).length === 2
    V['O3 ghost 子字段现状入账：第二轮没带的 extra 残存（不叠加≠整键替换）'] = p?.handleRet?.a?.extra === 2

    // 第三轮：另一个 child 完成——不得踩 a 的键
    await updateParentAgentTaskWithLock(parentCode, { agentCode: childB, toParentOutputKey: 'b', errorMode: 'continue' }, { handleStatus: 2, handleRet: { v: 'b1' } }, {})
    p = await raw()
    out.withB = { keys: Object.keys(p?.handleRet || {}).sort(), aKept: p?.handleRet?.a?.v === 'second', status: p?.handleStatus }
    V['O2 别的 child 完成不踩先写键；全终态父=2（重复轮不破坏聚合）'] =
        JSON.stringify(Object.keys(p?.handleRet || {}).sort()) === '["a","b"]'
        && p?.handleRet?.a?.v === 'second' && p?.handleStatus === 2
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 600)
} finally {
    try {
        await import('../../init.js')
        const { AgentTask } = await import('../../daos/core/schema/index.js')
        await AgentTask.collection.deleteMany({ agentCode: { $in: [parentCode, childA, childB] } })
        const residual = await AgentTask.collection.countDocuments({ agentCode: { $regex: '^okov-' } })
        V['C1 收尾清尽(residual=0)'] = residual === 0
    } catch { /* 清不掉也要出报告，残留由下轮 okov 前缀核对暴露 */ }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '幂等写回 e2e 通过(单键覆盖/不踩他键/ghost 现状入账/清尽)' : '未通(见 false 项)'
console.log('\n==== OUTPUTKEY-OVERWRITE E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
