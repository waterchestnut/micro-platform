/**
 * @fileOverview 产物查询面端到端取证（Agent UI 刀 B 服务端前置）
 * @module evals/platform-probes/artifact-query-e2e-probe
 * @description
 * 真 HTTP 四判据（零 relay、**自播种账行**——底座副本差异：母本复用 dev 存量、底座是干净环境）：
 *   A1 /list 成员 ⇒ 该会话的产物行返回（投影字段齐、artifactCode 在）
 *   A2 /list 非成员 ⇒ 403（成员制复用 resolveMessageScope 的实弹）
 *   A3 /read 无 fileCode 的 registered 行 ⇒ success:false 且理由=账行没有 fileCode
 *      （状态闸在 executeReadArtifactTool 执行体里生效——HTTP 面与模型面同一套拒法，不另造）
 *   A4 /read 不存在的 code ⇒ 404
 * 真实文件的读回 happy path 不在本探针重复造轮：PR-H2 已在模型面验证过 doc.api 字节读，
 * HTTP 面复用同一 executeReadArtifactTool（源码位守卫已钉"不许重写状态闸"）。
 * 用法：node evals/platform-probes/artifact-query-e2e-probe.mjs
 */
import { spawn } from 'node:child_process'

const PORT = 12049
const BASE = `http://127.0.0.1:${PORT}`
const USER = (c) => Buffer.from(JSON.stringify({userCode: c, realName: '产物e2e'})).toString('base64')
const V = {}
const out = {}
const EXPECTED = 4
const CONV = `art-query-e2e-${Date.now()}`
let server = null

async function api(path, body, user = 'menglb') {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST', headers: {'content-type': 'application/json', 'user-info': USER(user)},
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    })
    return {status: res.status, json: await res.json().catch(() => null)}
}

try {
    await import('../../init.js')
    const {Artifact, Conversation} = await import('../../daos/core/schema/index.js')
    // 底座自播种：建一条 menglb 为成员的会话 + 一条 registered 无 fileCode 的产物行
    // （母本复用 dev 存量账行；底座是干净环境，探针自带数据才独立成立——判据 A1..A4 不变）
    const nowD = new Date()
    await Conversation.collection.insertOne({conversationCode: CONV, title: '产物e2e', channel: 'micro_common', channelGroup: 'xxzx',
        conversationType: 'chat', llmModel: 'relay_common_pro', operator: {userCode: 'menglb', realName: '产物e2e'}, status: 0,
        userCodes: ['menglb'], internal: false, insertTime: nowD, updateTime: nowD})
    const seedCode = `art-qprobe-${nowD.getTime()}`
    await Artifact.collection.insertOne({artifactCode: seedCode, conversationCode: CONV, userCode: 'menglb',
        name: 'probe.md', kind: 'file', state: 'registered', fileCode: '', sizeBytes: 0, status: 0, insertTime: nowD, updateTime: nowD})
    const mine = await Artifact.collection.findOne({conversationCode: CONV}, {projection: {artifactCode: 1, state: 1}})
    if (!mine) throw new Error(`自播种失败：${CONV} 查不到行`)
    out.scout = {artifactCode: mine.artifactCode, state: mine.state}

    server = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(), env: {...process.env, PORT: String(PORT), FASTIFY_ADDRESS: '127.0.0.1'},
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    server.stdout.on('data', (d) => { buf += d.toString() })
    server.stderr.on('data', (d) => { buf += d.toString() })
    const t0 = Date.now()
    while (!buf.includes('服务器启动成功')) {
        if (Date.now() - t0 > 90000) throw new Error('server 启动超时: ' + buf.slice(-300))
        await new Promise((r) => setTimeout(r, 1000))
    }

    const l1 = await api('/core/artifact/list', {conversationCode: CONV})
    const items = l1.json?.data?.items || l1.json?.items || []
    out.A1 = {status: l1.status, n: items.length, first: items[0] ? Object.keys(items[0]).length : 0}
    V['A1 成员 /list ⇒ 会话产物行返回且投影字段齐'] = l1.status === 200 && items.length >= 1
        && items[0].artifactCode && 'state' in items[0] && 'sizeBytes' in items[0] && 'version' in items[0]

    const l2 = await api('/core/artifact/list', {conversationCode: CONV}, 'attacker-zzz')
    out.A2 = {status: l2.status}
    V['A2 非成员 /list ⇒ 403（成员制复用实弹）'] = l2.status === 403

    const r3 = await api('/core/artifact/read', {artifactCode: mine.artifactCode, offset: 0, limit: 100})
    const d3 = r3.json?.data || r3.json
    out.A3 = {status: r3.status, d3: JSON.stringify(d3 || {}).slice(0, 160)}
    V['A3 /read 无 fileCode 行 ⇒ 执行体状态闸如实拒（不崩、不另造第二套拒法）'] =
        r3.status === 200 && d3 && d3.success === false && /fileCode/.test(d3.error || '')

    const r4 = await api('/core/artifact/read', {artifactCode: 'art-nonexistent-zzz'})
    out.A4 = {status: r4.status}
    V['A4 /read 不存在 ⇒ 404'] = r4.status === 404
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 700)
} finally {
    if (server && !server.killed) { server.kill(); await new Promise((r) => setTimeout(r, 1500)) }
    try {
        const {Artifact, Conversation} = await import('../../daos/core/schema/index.js')
        const rA = await Artifact.collection.deleteMany({conversationCode: CONV})
        const rC = await Conversation.collection.deleteMany({conversationCode: CONV})
        out.residual = {artifacts: rA.deletedCount > 0 ? rA.deletedCount : 0, convs: rC.deletedCount > 0 ? rC.deletedCount : 0}
    } catch { /* 清理失败不掩盖判据结论 */ }
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '产物查询面 e2e 通过(列表投影/403/状态闸拒/404)' : '未通(见 false 项)'
console.log('\n==== ARTIFACT-QUERY E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
