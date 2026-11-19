/**
 * @fileOverview 附件授权前门端到端取证（B-1，属主拍板②"附件 B"，2026-11-19）
 * @module evals/platform-probes/task-attachment-e2e-probe
 * @description
 * 真 execChat 工具循环（同进程执行器，conv-visibility/fanout 先例）+ 剧本中继 + **假 doc.api
 * 提取服务**（响应形状照抄 doc.api routes/file/root.js:25 源码读数；doc.api 的提取真能力是它自家
 * 已上线面——AI 判分在用，本探针要证的是 **llm.api 侧授权链**，外部面命中计数恰是更强的判据）：
 *   T1 清单内 fileCode 真读回正文（注册→分类→判定→doc.api 调用→钳制→合并全链走通）；
 *   T2 清单外 fileCode ⇒ not-in-snapshot 拒话；
 *   T2b 假 doc.api 的 hits 恰等于 ['fc-probe-ok']——**红线在 IO 之前**，forbidden 根本没出门；
 *   T3a 带 taskContext 的 run：read_attachment 出现在 tools 声明面（中继读数）；
 *   T3b 对照组（普通轮无 taskContext）：tools 声明面没有它，且 run 照常收尾（逐字现网）；
 *   C1 种子账清尽。
 * （六判据=T1/T2/T2b/T3a/T3b/C1；两次 run 的 messageCode/conversation 全合成、事后删净。）
 * 用法：node evals/platform-probes/task-attachment-e2e-probe.mjs（本机 src 目录下；需 dev 库可达）
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'

const RELAY_PORT = 13062
const DOC_PORT = 13061
const OBS = `${process.env.TEMP || '/tmp'}\\attach-obs.json`
const ts = Date.now()
const conv1 = `att-conv-A-${ts}`
const conv2 = `att-conv-B-${ts}`
const msg1 = `att-msg-a-${ts}`
const msg2 = `att-msg-b-${ts}`
const rootCode = `att-root-${ts}`
const USER = {userCode: 'menglb', realName: '附件前门e2e'}
const V = {}
const out = {}
const EXPECTED = 6
let relay = null
let docSrv = null
const docHits = []

try {
    // env 必须先于 init：relay 指假中继、doc.api 指假提取、前门开
    process.env.LLM_RELAY_BASE_URL = `http://127.0.0.1:${RELAY_PORT}/v1`
    process.env.docApiConfig_baseIntranetUrl = `http://127.0.0.1:${DOC_PORT}`
    process.env.limits_taskAttachment = 'true'
    try { fs.rmSync(OBS, {force: true}) } catch { /* 不存在最好 */ }

    await import('../../init.js')
    const {AgentTask, Message, Conversation} = await import('../../daos/core/schema/index.js')
    const {execChat} = await import('../../services/core/llmChat.js')

    // 假 doc.api：响应形状=doc.api routes/file/root.js:25 + fileExtract 返回 {text,docType,viaOcr,truncated}
    docSrv = http.createServer((req, res) => {
        let b = ''
        req.on('data', (c) => { b += c })
        req.on('end', () => {
            if (req.method === 'POST' && (req.url || '').includes('/file/extract/text')) {
                const fileCode = String(JSON.parse(b || '{}').fileCode || '')
                docHits.push(fileCode)
                res.writeHead(200, {'content-type': 'application/json'})
                res.end(JSON.stringify({code: 0, statusCode: 200,
                    data: {text: 'PROBE附件正文：三节点48闸容量报告全文。', docType: 'txt', viaOcr: false, truncated: false}}))
                return
            }
            res.writeHead(404, {'content-type': 'application/json'})
            res.end('{"code":-1,"message":"fake-doc-api only extract"}')
        })
    }).listen(DOC_PORT)

    relay = spawn(process.execPath, ['evals/platform-probes/fake-relay-attach.mjs', `--port=${RELAY_PORT}`, `--observe=${OBS}`],
        { cwd: process.cwd(), stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 1500))

    // 种子：root 行（params.attachments=发起快照）+ 两个会话
    await Conversation.collection.insertOne({conversationCode: conv1, insertTime: new Date()})
    await Conversation.collection.insertOne({conversationCode: conv2, insertTime: new Date()})
    await AgentTask.collection.insertOne({
        agentCode: rootCode, agentRole: 'root', orchestrated: true, handleStatus: 2,
        conversationCode: conv1, operator: USER,
        params: {attachments: [{fileCode: 'fc-probe-ok', name: '容量报告.txt'}]},
        insertTime: new Date(), updateTime: new Date(),
    })

    // run1：带 taskContext 的 child 形态 run（三轮剧本）
    await execChat(USER, '读一下我上传的容量报告并总结（附件前门探针）', conv1, {
        channel: 'micro_common', protocol: 2, cache: false, messageCode: msg1,
        taskContext: {rootCode, agentCode: rootCode, agentRole: 'child'},
        streamCallback: () => {},
    })

    // run2：普通轮对照（无 taskContext；query 带 CTRLRUN 让中继走 plain 分支）
    await execChat(USER, '普通轮对照（CTRLRUN 标记仅供剧本分流）', conv2, {
        channel: 'micro_common', protocol: 2, cache: false, messageCode: msg2,
        streamCallback: () => {},
    })

    const obs = JSON.parse(fs.readFileSync(OBS, 'utf8'))
    const msgs = obs.run1.toolResults || []
    const m1 = msgs.length >= 2 ? JSON.parse(msgs[0]) : {}
    const m2 = msgs.length >= 2 ? JSON.parse(msgs[1]) : {}
    out.T1 = {toolRounds: obs.run1.toolRounds, text: String(m1?.data?.text || '').slice(0, 60), docType: m1?.data?.docType}
    V['T1 清单内 fileCode 全链读回（success+正文+docType）'] =
        obs.run1.toolRounds === 2 && m1.success === true && String(m1.data?.text).includes('PROBE附件正文') && m1.data?.docType === 'txt'
    out.T2 = {authorization: m2.authorization, success: m2.success, err: String(m2.error || '').slice(0, 80)}
    V['T2 清单外 fileCode ⇒ not-in-snapshot 拒话'] =
        m2.success === false && m2.authorization === 'not-in-snapshot'
    out.T2b = {docHits}
    V['T2b 假 doc.api hits 恰=fc-probe-ok（红线在 IO 之前，forbidden 没出门）'] =
        docHits.length === 1 && docHits[0] === 'fc-probe-ok'
    out.T3a = {run1SawTool: obs.run1.sawTool}
    V['T3a 带 taskContext：read_attachment 在 tools 声明面'] = obs.run1.sawTool === true
    out.T3b = {run2SawTool: obs.run2.sawTool, answered: obs.run2.answered}
    V['T3b 普通轮对照：声明面没有该工具且 run 照常收尾'] = obs.run2.sawTool === false && obs.run2.answered === true

    await AgentTask.collection.deleteMany({agentCode: rootCode})
    await Message.collection.deleteMany({conversationCode: {$in: [conv1, conv2]}})
    await Conversation.collection.deleteMany({conversationCode: {$in: [conv1, conv2]}})
    const residual = await AgentTask.collection.countDocuments({agentCode: rootCode})
        + await Message.collection.countDocuments({conversationCode: {$in: [conv1, conv2]}})
        + await Conversation.collection.countDocuments({conversationCode: {$in: [conv1, conv2]}})
    out.C1 = {residual}
    V['C1 种子账清尽(residual=0)'] = residual === 0
} catch (e) {
    out.错误 = String(e?.stack || e?.message || e).slice(0, 800)
} finally {
    if (relay && !relay.killed) relay.kill()
    if (docSrv) docSrv.close()
}

const ran = Object.keys(V).length
const allTrue = !out.错误 && ran === EXPECTED && Object.values(V).every(Boolean)
out.verdict = V
out.结论 = out.错误 ? `未通(抛错:${String(out.错误).slice(0, 150)})`
    : ran < EXPECTED ? `未通(判据 ${ran}/${EXPECTED})` : allTrue ? '附件授权前门 e2e 通过(读回/拒外/不出门/双声明面/清尽)' : '未通(见 false 项)'
console.log('\n==== TASK-ATTACHMENT E2E RESULT ====')
console.log(JSON.stringify(out, null, 1))
process.exit(allTrue ? 0 : 2)
