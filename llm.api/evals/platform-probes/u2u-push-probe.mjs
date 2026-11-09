/**
 * @fileOverview u2u 实时推送的端到端验证（v1.30 的修复证明）
 * @module evals/platform-probes/u2u-push-probe
 * @description
 * 这条链在 git 里从来没有被执行过（`publishU2uEvent` 连定义带调用自首提交就被注释），
 * 所以"启用后到底通不通"没有任何历史证据可依，必须真跑一遍两个端：
 *   教师发 → 学生订阅 → 教师再发（学生应立刻收到 `event: message`）
 *   → 学生标已读（教师应立刻收到 `event: read`）
 *
 * 为什么在本地跑而不是 dev：本地进程连的是**同一套 dev redis/mongo**，
 * pub/sub 的扇出行为与 dev 一致，而本地能自己控制两端、不占用 dev 的发布窗口。
 * 本地没有网关，鉴权按本项目的信任模型走 `user-info` 头（网关正常时由它注入）。
 *
 * 用法（在 `src/` 下）：
 *   $env:checkpoint_enabled='true'; node evals/platform-probes/u2u-push-probe.mjs
 *   node evals/platform-probes/u2u-push-probe.mjs --push=off     # 反面对照：关掉推送应收不到
 *
 * 只写自己新建的 u2u 会话（teacher/student 用探针工号）。
 */
import http from 'node:http'

const PORT = Number(process.env.PROBE_PORT || 12018)
const argv = process.argv.slice(2)
const valOf = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.split('=')[1] : d
}
/** 反面对照：`--push=off` 时必须收不到消息帧——证明"收到了"确实是推送带来的，不是轮询或巧合 */
const PUSH = valOf('push', 'on')
const TEACHER = {userCode: 'T-SIM-001', realName: '探针教师'}
const STUDENT = {userCode: 'S-SIM-001', realName: '探针学生'}
const log = (note, obj) => console.log(JSON.stringify({probe: 'u2u-push', note, ...obj}))
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')

/**
 * env 必须在 import app 之前定好：`conf/system.config.js` 在导入期就把配置算完，
 * 写在静态 import 之后的赋值**一次也不会生效**（ES import 是提升的）。
 * 这个坑我在 gate-under-load 里已经踩过一次，这个探针又踩了一次——
 * 差别只是这次有反面对照，所以"开关没生效"当场被读出来：**没有反面对照的开关等于没有开关。**
 */
process.env.u2u_pushEnabled = PUSH === 'off' ? 'false' : 'true'

const {default: Fastify} = await import('fastify')
const {default: appService} = await import('../../app.js')
const {accessLoggerOptions} = await import('../../logger/index.js')

const app = Fastify({logger: accessLoggerOptions})
await app.register(appService)
await app.listen({port: PORT, host: '127.0.0.1'})
const BASE = `http://127.0.0.1:${PORT}`

/**
 * @description 调 u2u 接口
 * @param {String} path 路径
 * @param {Object} body 请求体
 * @param {Object} user 身份（本地按 user-info 头的信任模型）
 * @returns {Promise<Object>} 响应
 */
async function api(path, body, user) {
    const r = await fetch(BASE + path, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'user-info': b64(user)},
        body: JSON.stringify(body),
    })
    return await r.json().catch(() => ({__parseFail: true, status: r.status}))
}

/**
 * @description 开一条 u2u SSE，记录事件帧
 * @param {String} conversationCode 会话
 * @param {Object} user 身份
 * @returns {{events: Array, stop: Function, opened: Promise}} 句柄
 */
function subscribe(conversationCode, user) {
    const events = []
    const ac = new AbortController()
    const opened = (async () => {
        const r = await fetch(`${BASE}/core/chat/u2u/message/stream`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': b64(user)},
            body: JSON.stringify({conversationCode}),
            signal: ac.signal,
        })
        const dec = new TextDecoder()
        let buf = ''
        for await (const cv of r.body) {
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                const t = f.trim()
                if (!t) {
                    continue
                }
                if (t.startsWith(':')) {
                    events.push({kind: 'ping', at: Date.now()})
                    continue
                }
                const ev = /event:(\S+)/.exec(f)?.[1] || 'data'
                const raw = (/data:([\s\S]+)/.exec(f)?.[1] || '').replace(/\n/g, '')
                let parsed = null
                try {
                    parsed = JSON.parse(raw)
                } catch (e) { /* connected 之外的帧可能不是 JSON */ }
                events.push({kind: ev, at: Date.now(), parsed})
            }
        }
    })().catch(e => {
        if (e?.name !== 'AbortError') {
            log('订阅异常', {err: String(e?.message || e).slice(0, 120)})
        }
    })
    return {events, opened, stop: () => ac.abort()}
}

const stamp = Date.now()
const mk = (tag) => `u2u-push-${stamp}-${tag}`

/* 1) 教师先发一条：会话由此创建，并拿到 conversationCode */
const first = await api('/core/chat/u2u/message/send',
    {targetUserCode: STUDENT.userCode, content: '推送探针：第一条', messageCode: mk('m1')}, TEACHER)
const conversationCode = first?.data?.conversationCode
log('第一条已发', {code: first?.code, conversationCode, msg: first?.msg || ''})
if (!conversationCode) {
    log('结论', {判定: '❌ 连第一条消息都没发出去（多半是两人没有导师关系，或关系校验 fail-closed 了）：'
        + `返回 ${JSON.stringify(first).slice(0, 200)}`})
    process.exit(1)
}

/* 2) 学生订阅 —— 必须等 connected 帧到了再发第二条，否则测的是"离线补投"而不是实时推送 */
const studentSub = subscribe(conversationCode, STUDENT)
const tEachSub = subscribe(conversationCode, TEACHER)
const waitForConnected = async (sub, who) => {
    const t0 = Date.now()
    while (Date.now() - t0 < 8000) {
        if (sub.events.some(e => e.kind === 'connected')) {
            return true
        }
        await new Promise(r => setTimeout(r, 80))
    }
    log('等 connected 超时', {who, 已收到: sub.events.map(e => e.kind)})
    return false
}
const sReady = await waitForConnected(studentSub, '学生')
const tReady = await waitForConnected(tEachSub, '教师')

/* 3) 教师发第二条：学生的流里应出现 event: message */
const beforeMsg = studentSub.events.filter(e => e.kind === 'message').length
await api('/core/chat/u2u/message/send',
    {targetUserCode: STUDENT.userCode, content: '推送探针：第二条', messageCode: mk('m2')}, TEACHER)
await new Promise(r => setTimeout(r, 2500))
const gotMsg = studentSub.events.filter(e => e.kind === 'message')

/* 4) 学生标已读：教师的流里应出现 event: read */
await api('/core/chat/u2u/message/read', {conversationCode}, STUDENT)
await new Promise(r => setTimeout(r, 2500))
const gotRead = tEachSub.events.filter(e => e.kind === 'read')

/** 收到的消息帧内容（含 fromMe——这是"按人各发一份"是否真生效的判据） */
const msgDetail = gotMsg.map(e => ({
    content: e.parsed?.content, fromMe: e.parsed?.fromMe, sender: e.parsed?.sender?.userCode,
}))
const readDetail = gotRead.map(e => ({upToTime: e.parsed?.upToTime}))

studentSub.stop(); tEachSub.stop()
await new Promise(r => setTimeout(r, 200))
await app.close()

const checks = {
    两端都建好连接: {got: `学生=${sReady}, 教师=${tReady}`, ok: sReady && tReady},
    学生收到message: {got: `${gotMsg.length} 帧（订阅前 ${beforeMsg}）`, ok: PUSH === 'off' ? gotMsg.length === 0 : gotMsg.length >= 1},
    教师收到read: {got: `${gotRead.length} 帧`, ok: PUSH === 'off' ? gotRead.length === 0 : gotRead.length >= 1},
    payload按人序列化: {got: JSON.stringify(msgDetail), ok: PUSH === 'off' ? true : msgDetail.every(m => m.fromMe === false && m.sender === TEACHER.userCode)},
    不越权推给自己: {got: `教师流的 message 帧=${tEachSub.events.filter(e => e.kind === 'message').length}`,
        /** 教师自己发的消息不该推给教师自己（否则会多一次无谓的已读回写与游标跳动） */
        ok: tEachSub.events.filter(e => e.kind === 'message').length === 0 || PUSH === 'off'},
}
const allOk = Object.values(checks).every(c => c.ok)
log('读数', {推送开关: PUSH, 学生帧序列: studentSub.events.map(e => e.kind), 教师帧序列: tEachSub.events.map(e => e.kind), message内容: msgDetail, read内容: readDetail})
log('判定', {
    各条: checks,
    结论: allOk
        ? (PUSH === 'off'
            ? '✅ 反面对照成立：关掉推送时两端都收不到 message/read ⇒ 前面收到的帧确实来自推送，不是轮询或巧合'
            : '✅ 推送链通了：学生实时收到 event:message（payload 的 fromMe=false、sender=教师），教师实时收到 event:read，'
                + '且教师不会收到自己发的推送 ⇒ §26.2 里 PR-C 的实时前提从此具备')
        : `❌ 有不符合预期的项，见上面各条读数`,
})
process.exit(allOk ? 0 : 1)
