/**
 * @fileOverview P-9b 实测：静默期谁先切连接，`:ping` 能不能救活
 * @module evals/platform-probes/p9b-run
 * @description
 * §2B.2 记过两层超时：dev 侧 rke2-ingress-nginx `proxy-read-timeout` 默认 60s、APISIX `send_timeout 10s`；
 * 生产 Traefik `idleTimeout` 180s 且改不了。v1.19 上线 `:ping`（静默 8s 一帧注释）后，
 * **本地只证明了"帧写出去了"，没证明"这帧穿过网关还能把空闲计时器顶住"**——而后者才是 PR-C 续接体验的前提。
 *
 * 为什么用 u2u：它是现成唯一"会长时间真的静默"的 SSE 通道（等对方发消息，没有内容可发），
 * 不需要为了造静默去消耗模型 token。
 *
 * 关键设计：**中途插一条真消息**。
 * 只看"连接活到 130s"不够——网关静默断开有时表现为"连接还在但消息再也收不到"。
 * 所以在观察窗中段由教师再发一条消息，只有**订阅端确实收到这条事件**，才算"这条通道活着"。
 *
 * 用法（在 `src/` 下；两个 dev token 由 ucenter 的 p9b-mint 落在临时目录，本脚本不打印它们）：
 *   node evals/platform-probes/p9b-run.mjs
 *   node evals/platform-probes/p9b-run.mjs --wait=200 --interject=45
 *
 * 前置：dev 上 T-SIM-001 与 S-SIM-001 之间有导师关系（`p9b-scope-setup.mjs` 建的，可 `--rollback`）。
 */
import fs from 'node:fs'

const BASE = process.env.PROBE_BASE || 'https://api.xxzx.paretop.net/llm'
const TOKEN_DIR = 'C:/Users/menglb/AppData/Local/Temp/opencode'
const TEACHER = process.env.PROBE_TEACHER || 'T-SIM-001'
const STUDENT = process.env.PROBE_STUDENT || 'S-SIM-001'
const argv = process.argv.slice(2)
const valOf = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? Number(hit.split('=')[1]) : d
}
/** 观察窗（秒）与"中途插话"的时刻（秒） */
const WAIT_S = valOf('wait', 130)
const INTERJECT_S = valOf('interject', 45)
const log = (note, obj) => console.log(JSON.stringify({probe: 'p9b', note, ...obj}))

/**
 * @description 读取 mint 好的 dev token（只读文件，不外泄到输出）
 * @param {String} userCode 工号
 * @returns {Object} token 记录
 */
function readToken(userCode) {
    const p = `${TOKEN_DIR}/p9b-token-${userCode}.json`
    if (!fs.existsSync(p)) {
        throw new Error(`缺 ${p}：先跑 ucenter 的 tools/p9b-mint.mjs ${userCode} <密码>`)
    }
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (!j.accessToken) {
        throw new Error(`${p} 里没有 accessToken`)
    }
    log('身份就绪', {userCode, mintTime: j.mintTime, token前缀: j.accessToken.slice(0, 4) + '…'})
    return j
}

const teacher = readToken(TEACHER)
const student = readToken(STUDENT)

/**
 * @description 调 dev 网关上的 llm.api
 * @param {String} path 路径
 * @param {Object} body 请求体
 * @param {String} accessToken 身份
 * @returns {Promise<Object>} 响应 json
 */
async function api(path, body, accessToken) {
    const r = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'param-accessToken': accessToken},
        body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({__httpStatus: r.status}))
    return j
}

/* 1) 教师发第一条：会话不存在时由服务端创建 */
const first = await api('/core/chat/u2u/message/send', {targetUserCode: STUDENT, content: 'P-9b 探针：第一条'}, teacher.accessToken)
if (first?.code !== 0) {
    log('第一条消息失败', {ret: JSON.stringify(first).slice(0, 200)})
    throw new Error('u2u 发送失败：多半是导师关系没建好或 token 失效')
}
const conversationCode = first?.data?.conversationCode || first?.data?.message?.conversationCode
log('会话已建', {conversationCode})

/* 2) 学生订阅这条会话的 SSE，记录帧时间线 */
const t0 = Date.now()
const timeline = []
let bytes = 0, pings = 0, events = 0, closed = '', errMsg = ''
const ac = new AbortController()
const deadline = WAIT_S * 1000

/**
 * @description 把一帧 SSE 的原样内容压成一行（**必须保留冒号**：`: ping` 这种注释帧
 * 如果只在"是不是 ping"的布尔里出现，读日志的人永远不知道它到底长什么样，
 * 也就没法判断这 8 秒一帧的东西是不是网关吃掉的那个 ping）
 * @param {String} f 帧原文
 * @returns {String} 单行摘要
 */
function frameDigest(f) {
    const head = f.split('\n')[0] || ''
    const isComment = head.trim().startsWith(':')
    const one = f.replace(/\r?\n/g, '⏎').slice(0, 120)
    return `${isComment ? '注释帧' : '数据帧'}: ${one}`
}

/**
 * @description 在观察窗中段插一条真消息，用来证明连接真的还活着
 * @returns {Promise<void>} 无
 */
async function interject() {
    await new Promise(r => setTimeout(r, INTERJECT_S * 1000))
    const ret = await api('/core/chat/u2u/message/send', {targetUserCode: STUDENT, content: 'P-9b 探针：插话'}, teacher.accessToken)
    timeline.push({at: Date.now() - t0, kind: '__interject-sent', ok: ret?.code === 0})
    log('插话已发', {at: Date.now() - t0, code: ret?.code})
}
const interjectTimer = interject()

try {
    const r = await fetch(`${BASE}/core/chat/u2u/message/stream`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'param-accessToken': student.accessToken},
        body: JSON.stringify({conversationCode}),
        signal: ac.signal,
    })
    if (!r.ok) {
        closed = `http-${r.status}`
        errMsg = (await r.text().catch(() => '')).slice(0, 160)
    } else {
        const dec = new TextDecoder()
        let buf = ''
        const killer = setTimeout(() => ac.abort(), deadline)
        try {
            for await (const cv of r.body) {
                const at = Date.now() - t0
                bytes += cv.byteLength
                buf += dec.decode(cv, {stream: true})
                let i
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const f = buf.slice(0, i); buf = buf.slice(i + 2)
                    /**
                     * 注释帧的判据是"这一帧的第一行以冒号开头"，**不是** `^: `（冒号后带空格）。
                     * 第一版写成 `/^:(\s|$)/`，而实际发出的是 `:ping`——于是 14 帧心跳全被
                     * 计入"事件帧"，`心跳帧: 0`，还把结论指向"推送链坏了"。
                     * 又一次仪表自己骗自己：**分类器的判据错一位，读数就把人带偏一个方向。**
                     */
                    const trimmed = f.trim()
                    if (trimmed.startsWith(':')) {
                        pings++
                        timeline.push({at, kind: 'ping', 原文: frameDigest(f)})
                    } else {
                        events++
                        const ev = (/event:(\S+)/.exec(f)?.[1] || 'data')
                        timeline.push({at, kind: ev, 原文: frameDigest(f)})
                    }
                }
            }
        } catch (e) {
            if (e?.name !== 'AbortError') {
                throw e
            }
        } finally {
            clearTimeout(killer)
        }
        closed = closed || (Date.now() - t0 >= deadline - 50 ? '观察窗到点' : 'server-closed')
    }
} catch (e) {
    closed = e?.name === 'AbortError' ? 'client-stopped' : 'exception'
    errMsg = String(e?.message || e).slice(0, 160)
} finally {
    await interjectTimer.catch(() => {})
}

const elapsed = Date.now() - t0
/** 静默间隔：相邻两帧（含 ping）之间的最大空档 */
const at = [0, ...timeline.filter(t => !t.kind.startsWith('__')).map(t => t.at)]
const gaps = at.slice(1).map((v, i) => v - at[i])
const maxGap = gaps.length ? Math.max(...gaps) : elapsed
const gotInterject = timeline.some(t => t.kind === 'message' && t.at > INTERJECT_S * 1000 - 5000)
    || timeline.filter(t => t.kind === 'message').length >= 2

/*
 * 服务端侧再确认一次：插话到底进没进会话。
 * 这一步是为了把两种完全不同的故障分开——
 *   A 消息在库里、流里没推 ⇒ **推送链坏了**（订阅看着活着其实已瞎）
 *   B 消息根本没进库       ⇒ **发送侧就失败了**，与 ping/网关无关
 * 只凭 SSE 的表现分不清这两件事。
 */
const listRet = await api('/core/chat/u2u/message/list', {conversationCode, pageIndex: 1, pageSize: 10}, student.accessToken)
const serverRows = listRet?.data?.rows || listRet?.data?.list || []
const contents = serverRows.map(r => String(r.query || r.content || '').slice(0, 24))
const serverHasInterject = contents.some(c => c.includes('插话'))
log('服务端核对', {
    code: listRet?.code,
    会话内消息数: serverRows.length,
    内容摘要: contents,
    插话是否入库: serverHasInterject,
})

log('结果', {
    观察窗s: WAIT_S,
    实际持续ms: elapsed,
    字节: bytes,
    事件帧: events,
    心跳帧: pings,
    最大静默间隔ms: maxGap,
    插话是否收到: gotInterject,
    收尾: closed,
    错误: errMsg,
    时间线: timeline.slice(0, 40),
})

let verdict
if (closed === 'server-closed' || /^http-/.test(closed) || closed === 'exception') {
    verdict = `❌ 连接在 ${(elapsed / 1000).toFixed(1)}s 被切（${closed} ${errMsg}）：ping 没能救活 ⇒ PR-C 必须按"会断"设计续接`
} else if (!gotInterject && serverHasInterject) {
    verdict = `❌ **推送链故障**：插话已在服务端会话里（message/list 可见），但订阅端 ${WAIT_S}s 内没收到消息帧`
        + `（事件帧 ${events}、注释心跳 ${pings}）⇒ "连接活着但其实已瞎"，比断开更危险：前端会以为订阅成功。`
        + '这与网关超时无关，要查 u2u 的发布/订阅侧（redis pubsub 或进程内广播）'
} else if (!gotInterject) {
    verdict = `⚠️ 订阅端没收到插话，且服务端也没查到它（入库失败或列表口径不同）⇒ 先修发送/列表这条链，P-9b 需重跑`
} else if (pings > 0) {
    verdict = `✅ ping 穿过了 dev 网关：静默 ${WAIT_S}s 内收到 ${pings} 帧心跳、最大静默间隔 ${maxGap}ms，插话也被订阅端收到 ⇒ PR-C 可按"不必每 60s 重连"设计`
} else {
    verdict = maxGap < 60000
        ? `ℹ️ 连接活着、插话收到，但**一帧心跳都没出现**：静默不足 8s 或 u2u 通道没接 sseChannel 的心跳 ⇒ 需查 u2u 路由是否复用 ping 机制`
        : `⚠️ 连接活着且插话收到，但静默 ${maxGap}ms 内没有心跳：说明这条路径没发 ping，能撑住是因为网关比我们以为的宽`
}
log('结论', {判定: verdict, 会话: conversationCode})
process.exit(0)
