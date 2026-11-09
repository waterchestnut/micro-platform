/**
 * @fileOverview P-9b 实测：静默期谁先切连接，`:ping` 能不能救活
 * @module evals/platform-probes/idle-stream-probe
 * @description
 * §2B.2 记下过两层超时：dev 侧 rke2-ingress-nginx `proxy-read-timeout` 默认 60s、
 * APISIX `send_timeout 10s`；生产 Traefik `idleTimeout` 180s 且改不了。
 * v1.19 上线了 `:ping`（静默 8s 一帧注释），**但本地验证只证明"帧写出去了"，
 * 没证明"这帧穿过网关还能把空闲计时器顶住"**——而这正是 PR-C 续接体验的前提。
 *
 * 为什么用 u2u 长连接：它是现成唯一"会长时间真的静默"的 SSE 通道
 * （等对方发消息，没有内容可发），不需要为了造静默去消耗模型 token。
 *
 * 用法（在 `src/` 下）：
 *   node evals/platform-probes/idle-stream-probe.mjs                 # 默认 130s 观察窗
 *   node evals/platform-probes/idle-stream-probe.mjs --wait=200 --conv=<conversationCode>
 *
 * 凭据从临时目录的回归 session 文件读，不硬编码、不打印。
 */
import fs from 'node:fs'

const BASE = process.env.PROBE_BASE || 'https://api.xxzx.paretop.net/llm'
const SESSION = 'C:/Users/menglb/AppData/Local/Temp/opencode/school-sim-session.json'
const argv = process.argv.slice(2)
const valOf = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.split('=')[1] : d
}
const WAIT_MS = Number(valOf('wait', 130000))
const CONV = valOf('conv', 'd9d0a7a7b3b5320dc8a55b3f3f459fa4')
const log = (note, obj) => console.log(JSON.stringify({probe: 'idle-stream', note, ...obj}))

/**
 * @description 从回归 session 里挑一个"确实是我参与的 u2u 会话成员"的身份
 * @param {String} conversationCode 会话标识
 * @returns {Promise<{accessToken: String, userCode: String}>} 身份
 */
async function pickIdentity(conversationCode) {
    const sess = JSON.parse(fs.readFileSync(SESSION, 'utf8'))
    const candidates = [...(sess.teachers || []), ...(sess.students || [])].filter(t => t?.accessToken)
    for (const c of candidates) {
        const r = await fetch(`${BASE}/core/conversation/list`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'param-accessToken': c.accessToken},
            body: JSON.stringify({filter: {conversationCode}, pageIndex: 1, pageSize: 1}),
        })
        const j = await r.json().catch(() => null)
        if (j?.code === 0 && (j?.data?.rows || []).length) {
            return {accessToken: c.accessToken, userCode: c.userCode}
        }
        if (/token无效|4002/.test(JSON.stringify(j || {}))) {
            log('身份不可用', {userCode: c.userCode, note: 'token 过期或无效，换下一个'})
        }
    }
    throw new Error('没有可用的回归身份：session 文件里的 token 都失效了，需要重跑 school-sim-provision 或 cluster-mint')
}

const id = await pickIdentity(CONV)
log('取样身份', {userCode: id.userCode, 会话: CONV})

/* 打一条 u2u 长连接，记录帧到达的时间线与是否被切 */
const t0 = Date.now()
const timeline = []
let bytes = 0, pings = 0, events = 0, closed = '', err = ''
const ac = new AbortController()
const killer = setTimeout(() => ac.abort(), WAIT_MS)
try {
    const r = await fetch(`${BASE}/core/chat/u2u/message/stream`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'param-accessToken': id.accessToken,
        },
        body: JSON.stringify({conversationCode: CONV}),
        signal: ac.signal,
    })
    if (!r.ok) {
        closed = `http-${r.status}`
        err = (await r.text().catch(() => '')).slice(0, 160)
    } else {
        const dec = new TextDecoder()
        let buf = ''
        for await (const cv of r.body) {
            const at = Date.now() - t0
            bytes += cv.byteLength
            buf += dec.decode(cv, {stream: true})
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const f = buf.slice(0, i); buf = buf.slice(i + 2)
                if (/^:\s*ping\s*$/.test(f.trim())) {
                    pings++
                    timeline.push({at, kind: 'ping'})
                } else {
                    events++
                    timeline.push({at, kind: (/event:(\S+)/.exec(f)?.[1] || 'delta')})
                }
            }
        }
        closed = 'server-closed'
    }
} catch (e) {
    closed = e?.name === 'AbortError' ? 'client-stopped（观察窗到点，正常）' : 'exception'
    err = String(e?.message || e).slice(0, 160)
} finally {
    clearTimeout(killer)
}

const firstPing = timeline.find(t => t.kind === 'ping')
const gaps = []
let prev = 0
for (const t of timeline) {
    gaps.push(t.at - prev)
    prev = t.at
}
const maxGap = gaps.length ? Math.max(...gaps) : null

log('结果', {
    观察窗ms: WAIT_MS,
    实际持续ms: Date.now() - t0,
    字节: bytes,
    事件帧: events,
    心跳帧: pings,
    首个心跳at: firstPing?.at ?? null,
    最大静默间隔ms: maxGap,
    收尾: closed,
    错误: err,
})

const survived = (Date.now() - t0) >= WAIT_MS - 5000
log('结论', {
    判定: survived && pings > 0
        ? `✅ ping 穿过 dev 网关把连接顶住了：静默 ${WAIT_MS / 1000}s 内收到 ${pings} 帧心跳、最大静默间隔 ${maxGap}ms，连接没被任何一层切`
        : (survived && pings === 0
            ? '⚠️ 连接活着但没有心跳——说明这条路径压根没发 ping（检查 u2u 路由是否接了 sseChannel），或网关没有超时'
            : `❌ 连接在 ${(Date.now() - t0) / 1000}s 被切（${closed} ${err}）：ping 没能救活，PR-C 的续接必须按"会断"设计`),
})
process.exit(0)
