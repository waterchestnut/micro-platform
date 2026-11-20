/**
 * @fileOverview 编排树只读普查（§7-4/§8 观察项的可复跑账——A2 快照转正，只读零删改）
 * @module evals/platform-probes/orch-census-probe
 * @description
 * 本仓纪律"报告过的数必须能在仓里找到"：A2 首快照当时是临时脚本，账上数字没有复跑工具
 * ——本探针就是那个工具。**纯只读**（countDocuments/find 限列），任何批⑧后的观察项重测
 * 直接 `node evals/platform-probes/orch-census-probe.mjs`。
 *
 * 判据族（每项一句"治什么病"）：
 *  O1 悬 retry(st1+action=retry)      ——§7-4 修复的病形，恒 0 是回归哨兵
 *  O2 悬 pending(st1+action=pending)  ——B1 只派一次 × 未终局的同族病（0 命中不开刀的观察项本体）
 *  O3 budget-exhausted 树            ——§7-3 闸停形态的发生率
 *  O4 分层推进树(spawnedLayers>=1)    ——§8 真使用度
 *  O5 layerPlanReset 在账            ——replan×layered 组合的自然样本
 *  O6 分层收尾丢失靶(orchPlan 残)     ——B1 补派段的命中面（>0 说明有树等救）
 *  O7 orchestrated 血统内 done-盲区   ——usable 盲区（限 root 血统！建课 child 无 usable 概念，
 *                                      不限血统会扫出假数——A2 当日实锤的 scope 课）
 *  O9 非分层收尾丢失(B1 派发丢族)     ——gate 后出生 + 终态 + 无 orchestration + 无 orchPlan；
 *                                      n>0 才有资格谈扩恢复面（没账不开刀，先测账）
 *  残骸面：探针签名树计数（清扫批的复查位）
 * 输出 JSON 单块，供账本直接摘录。
 */
await import('../../init.js')
const { AgentTask } = await import('../../daos/core/schema/index.js')
const col = AgentTask.collection

// O9 出生门槛：批⑧（layered env）apply 当日 UTC 零点——之前的"终态无 orchestration"行
// 是 B1 前年代的合法停置（dev 保留树形状），圈进来=把历史当病形（越权老坑同族）
const GATE = new Date(process.env.CENSUS_GATE || '2026-11-20T00:00:00Z')

const out = { gate: GATE.toISOString() }
const cnt = async (f) => col.countDocuments(f)

out.O1_悬retry = await cnt({ orchestrated: true, handleStatus: 1, 'handleRet.orchestration.action': 'retry' })
out.O2_悬pending = await cnt({ orchestrated: true, handleStatus: 1, 'handleRet.orchestration.action': 'pending' })
out.O3_预算降级 = await cnt({ orchestrated: true, 'handleRet.orchestration.follow.degrade': 'budget-exhausted' })
out.O4_分层推进 = await cnt({ orchestrated: true, 'handleRet.orchestration.follow.spawnedLayers': { $gte: 1 } })
out.O5_换代清层 = await cnt({ orchestrated: true, 'handleRet.orchestration.follow.layerPlanReset': { $exists: true } })
out.O6_分层待救 = await cnt({ orchestrated: true, agentRole: 'root', handleStatus: { $in: [2, 3] }, 'handleRet.orchestration': null, 'params.orchPlan.0': { $exists: true } })
out.O9_非分层收尾丢失 = await cnt({
    orchestrated: true, agentRole: 'root', handleStatus: { $in: [2, 3] },
    'handleRet.orchestration': null, insertTime: { $gte: GATE },
    $and: [{ $or: [{ 'params.orchPlan': { $exists: false } }, { 'params.orchPlan': [] }] }],
})

// O7：先取 gate 后出生的 orchestrated roots，再限血统查 done-盲区（scope 课的正确姿势）
const roots = await col.find(
    { orchestrated: true, insertTime: { $gte: GATE } },
    { projection: { agentCode: 1, conversationCode: 1 } },
).limit(500).toArray()
const codes = roots.map((r) => r.agentCode).filter(Boolean)
out.roots总数 = codes.length
out.natural树 = roots.filter((r) => !/^(lyrprobe|b7-check|b8|siprobe|follprobe|fanwire|fanentry|idem|att-|grace|cap-|dev-gray|gray-open|convvis|bud|ev-)/i.test(String(r.conversationCode || ''))).length
if (codes.length) {
    out.O7_盲区done = await cnt({ parentCode: { $in: codes }, handleStatus: 2, 'handleRet.usable': { $ne: true } })
    out.O7_分层层行 = await cnt({ parentCode: { $in: codes }, 'params.layerIndex': { $gte: 1 } })
} else {
    out.O7_盲区done = 0; out.O7_分层层行 = 0
}
// 探针签名残骸复查（清扫批的回归位）
out.探针残骸 = await cnt({ orchestrated: true, conversationCode: { $regex: /^(follprobe|fanwire|fanentry|idem|att-|grace|cap-s|dev-gray|gray-open|b6-|b7-|b8|lyrprobe|convvis|bud|siprobe)/i } })

// content 形状观察线（array-content 间歇炸的复查位：生产读面 String() 兜底，这里只测写面是否再现）
out.观察_arrayContent = await cnt({ 'handleRet.content': { $type: 'array' } })

const s = JSON.stringify(out, null, 1)
console.log(s)
console.log('// 摘录入账：O1/O2 恒 0=§7-4 与 B1 病形回归哨兵；O9>0 再议恢复面扩展（没账不开刀）')
process.exit(0)
