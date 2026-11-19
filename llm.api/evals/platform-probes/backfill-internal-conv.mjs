/**
 * @fileOverview 存量工作会话 internal 标回填（一次性，可重复执行=幂等）
 * @module evals/platform-probes/backfill-internal-conv
 * @description
 * 会话可见性刀（conversationVisibility）的存量侧：建档点打标只管**新会话**，
 * 部署前由旧代码创建/回填时点之后由旧 executor 创建的 root:/agent: 会话没有 internal 标，
 * 会一直漏在用户列表里。本脚本用**同一判据函数**补标（两把尺子对账：regex 圈范围、
 * 判据定归属——不一致的行会被跳过并计数，防止两边语义漂移各标各的）。
 * 只标不删：数据一条不动，改的只是可见性语义。
 * 用法：node evals/platform-probes/backfill-internal-conv.mjs
 */
await import('../../init.js')
const {Conversation} = await import('../../daos/core/schema/index.js')
const {isInternalConversationCode} = await import('../../daos/core/policy/conversationVisibility.js')

const rows = await Conversation.collection.find({
    conversationCode: {$regex: '^(root|agent):'},
    internal: {$ne: true},
}).project({conversationCode: 1}).toArray()

let marked = 0, skipped = 0
for (const r of rows) {
    if (!isInternalConversationCode(r.conversationCode)) { skipped++; continue }
    await Conversation.collection.updateOne({conversationCode: r.conversationCode}, {$set: {internal: true}})
    marked++
}
const left = await Conversation.collection.countDocuments({conversationCode: {$regex: '^(root|agent):'}, internal: {$ne: true}})
const mainMarked = await Conversation.collection.countDocuments({internal: true, conversationCode: {$not: {$regex: '^(root|agent):'}}})
console.log(JSON.stringify({scanned: rows.length, marked, skipped, left, mainMarked}))
// mainMarked 必须为 0：非工作前缀的会话被标 internal=误伤用户主会话（本回填的地基判据）
process.exit(mainMarked === 0 && left === 0 ? 0 : 2)
