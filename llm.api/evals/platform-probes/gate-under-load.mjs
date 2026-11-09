/**
 * @fileOverview PR-0.4 的实测：闸到底挡不挡得住、放不放得回来
 * @module evals/platform-probes/gate-under-load
 * @description
 * 计划里一直挂着一条"**从没做过的验证**：闸到底挡不挡得住"。单元测试只能证明判定，
 * 证不了三件真正会出事的事：
 *   1. 拒绝发生在 **SSE 头之后还是之前**（如果已经 writeHead(200)，客户端收到的就是一条形如正常的流）；
 *   2. 在途数**会不会只进不出**（少一次 release 就是"用久了整站卡"，症状酷似上游故障）；
 *   3. 拒掉的那部分**有没有占格子**（占了就等于自己把自己喂满）。
 *
 * 装置：假 relay 每条流睡 `HOLD_MS`，本地起 llm.api 并把闸设成 `limit=2`，
 * 同时打 6 条真实请求，看回包形态、`/runStats` 的读数与收尾后的清零。
 *
 * 用法（在 `src/` 下）：
 *   node evals/platform-probes/gate-under-load.mjs
 *   node evals/platform-probes/gate-under-load.mjs --limit=2 --fanout=6 --hold=2500
 */
import http from 'node:http'

const PORT = Number(process.env.PROBE_PORT || 12017)
const RELAY_PORT = Number(process.env.PROBE_RELAY_PORT || 3098)
const argv = process.argv.slice(2)
const valOf = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? Number(hit.split('=')[1]) : d
}
const LIMIT = valOf('limit', 2)
const FANOUT = valOf('fanout', 6)
const HOLD_MS = valOf('hold', 2500)
const PER_USER = valOf('perUser', 0)
/** 每条请求用不同工号（1..N），才能测出"单用户额度"不误伤别人 */
const MULTI_USER = process.argv.includes('--multiUser')
const log = (note, obj) => console.log(JSON.stringify({probe: 'gate-under-load', note, ...obj}))

/** 闸要在**进程启动前**就配好：配置在导入期算完（v1.27 那次就是栽在这儿） */
Object.assign(process.env, {
    limits_concurrentRuns: String(LIMIT),
    limits_concurrentRunsPerUser: String(PER_USER),
    relay_common_pro_baseURL: `http://127.0.0.1:${RELAY_PORT}/v1`,
    relay_common_pro_apiKey: 'sk-fake',
})

/**
 * @description 假 relay：每条流都睡够 HOLD_MS 才吐字，好在途时间可控
 * @returns {Promise<{server: Object, stats: Object}>} 装置
 */
function makeSlowRelay() {
    const stats = {started: 0}
    const server = http.createServer((req, res) => {
        let raw = ''
        req.on('data', () => {})
        req.on('end', async () => {
            stats.started++
            res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'})
            await new Promise(r => setTimeout(r, HOLD_MS))
            res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"好"}}]}\n\n')
            res.write('data: {"choices":[{"index":0,"delta":{"content":"的"},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11}}\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
        })
    })
    return new Promise(resolve => server.listen(RELAY_PORT, '127.0.0.1', () => resolve({server, stats})))
}

const relay = await makeSlowRelay()
const {default: appService} = await import('../../app.js')
const {accessLoggerOptions} = await import('../../logger/index.js')
const {default: Fastify} = await import('fastify')

const app = Fastify({logger: accessLoggerOptions})
await app.register(appService)
await app.listen({port: PORT, host: '127.0.0.1'})
const userInfo = Buffer.from(JSON.stringify({userCode: 'menglb', realName: '探针'})).toString('base64')

/**
 * @description 打一条流式请求，只关心"是被闸拒了，还是进了流"
 * @param {Number} i 序号
 * @returns {Promise<Object>} 单条结果
 */
async function one(i) {
    const t0 = Date.now()
    /** `--multiUser` 时每条换一个工号：单用户额度只有这样才能测出来 */
    const userCode = MULTI_USER ? `gate-user-${i}` : 'menglb'
    const userInfoB64 = Buffer.from(JSON.stringify({userCode, realName: '闸压测'})).toString('base64')
    try {
        const r = await fetch(`http://127.0.0.1:${PORT}/core/chat/stream`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': userInfoB64},
            body: JSON.stringify({
                query: `闸压测 ${i}`,
                conversationCode: `gate-${Date.now()}-${i}`,
                options: {channel: 'xxzx_common', protocol: 2, cache: false},
            }),
            signal: AbortSignal.timeout(HOLD_MS + 25000),
        })
        const ct = r.headers.get('content-type') || ''
        /** 被拒的形态必须是 JSON + Retry-After；如果它也是 event-stream，就说明拒绝发生在头之后 */
        if (ct.includes('application/json')) {
            const j = await r.json().catch(() => ({}))
            return {
                i, kind: 'rejected', http: r.status, code: j.code, msg: j.msg,
                /**
                 * `success:false` 是四端 x-sdk 唯一的错误通道（`jsonResponseHandler` 里
                 * `chunk.success === false` 才走 onError）。缺了它，拒绝会被当成一条正常内容，
                 * 用户看到的是空回答——所以这个字段不是风格问题，是"能不能看见拒绝"的问题。
                 */
                success: j.success, sdkName: j.name, message: j.message,
                reason: j?.data?.reason, reportedActive: j?.data?.active, reportedLimit: j?.data?.limit,
                retryAfter: r.headers.get('retry-after'), ms: Date.now() - t0,
            }
        }
        const dec = new TextDecoder()
        let buf = ''
        let sawContent = ''
        for await (const cv of r.body) {
            buf += dec.decode(cv, {stream: true})
            const m = /"content":"([^"]*)"/g.exec(buf)
            if (m) {
                sawContent = m[1]
            }
        }
        return {i, kind: 'admitted', http: r.status, sawContent, ms: Date.now() - t0}
    } catch (e) {
        return {i, kind: 'error', err: String(e?.message || e).slice(0, 100), ms: Date.now() - t0}
    }
}

/**
 * @description 读闸的计数
 * @returns {Promise<Object>} 读数
 */
async function stats() {
    const r = await fetch(`http://127.0.0.1:${PORT}/core/chat/runStats`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'user-info': userInfo},
        body: JSON.stringify({}),
    })
    const j = await r.json().catch(() => ({}))
    return j?.data ?? j
}

log('配置', {limit: LIMIT, 并发打: FANOUT, 每条在途ms: HOLD_MS})
const t0 = Date.now()
/** 同时发车：不 stagger，否则测不出"抢格子" */
const allDone = Promise.all(Array.from({length: FANOUT}, (unused, i) => one(i + 1)))
/**
 * 中途读数必须在**流还在途时**采。
 * 上一版直接 `await Promise.all(...)` 之后再采，结果读出来 `active=0`——那不是"闸没计数"，
 * 是采样点放错了位置，而一个叫"中途读数"的字段给出终态值，读日志的人一定会误判。
 * 现在：发车后等 `HOLD_MS/2` 再采，此时应恰好有 `limit` 个格子占着。
 */
await new Promise(r => setTimeout(r, Math.round(HOLD_MS / 2)))
const midStats = await stats()
const results = await allDone
const admitted = results.filter(r => r.kind === 'admitted')
const rejected = results.filter(r => r.kind === 'rejected')
const errored = results.filter(r => r.kind === 'error')
log('发车结果', {墙钟ms: Date.now() - t0, 进流: admitted.length, 被拒: rejected.length, 出错: errored.length})
log('中途读数', {...midStats, 采样于ms: Math.round(HOLD_MS / 2)})

/* 全部收尾后再看一次：格子必须清零，否则就是泄漏 */
await new Promise(r => setTimeout(r, 1200))
const endStats = await stats()
log('收尾读数', endStats)
relay.server.close()
await app.close()

const shapeOk = rejected.every(r => r.http === 200 && r.code === 4290)
const headerOk = rejected.every(r => Number(r.retryAfter) >= 1)
/**
 * 三种形态的期望各不相同，而这正是要分别跑的理由：
 * - `perUser=0`：能进流的正好等于总上限；
 * - `perUser>0` + `--multiUser`（每人一条）：**个人额度不该误伤别人**，进流数 = min(limit, fanout)；
 * - `perUser>0` 且同一个人连发（不加 `--multiUser`）：进流数 = min(limit, perUser)，
 *   其余必须拿到"你有多个问题正在处理中"这条**可区分**的文案。
 *   少了这一种形态，`user-full` 分支在端到端上就从未被走到过——单元测试过了不等于接线对。
 */
const expectAdmitted = PER_USER > 0
    ? (MULTI_USER ? Math.min(LIMIT, FANOUT) : Math.min(LIMIT, PER_USER))
    : LIMIT
/** 同一个人连发时，拒绝文案必须是个人额度那条 */
const expectUserMsg = PER_USER > 0 && !MULTI_USER
const checks = {
    模式: {got: `limit=${LIMIT} perUser=${PER_USER} multiUser=${MULTI_USER}`, ok: true},
    进流数符合期望: {got: `${admitted.length}/${expectAdmitted}`, ok: admitted.length === expectAdmitted},
    其余被拒: {got: `${rejected.length}/${FANOUT - expectAdmitted}`, ok: rejected.length === FANOUT - expectAdmitted},
    拒绝是JSON而非半开流: {got: shapeOk ? '全部 JSON' : JSON.stringify(rejected.slice(0, 2)), ok: shapeOk},
    带RetryAfter: {got: [...new Set(rejected.map(r => r.retryAfter))].join(','), ok: headerOk},
    /** `user-full` 分支只在"同一个人连发"这一种形态下才会被走到，必须单独跑一次证明它接对了 */
    拒绝原因可区分: {
        got: [...new Set(rejected.map(r => r.reason))].join(','),
        ok: expectUserMsg
            ? rejected.every(r => r.reason === 'user-full')
            : rejected.every(r => r.reason === 'global-full'),
    },
    /**
     * 单独一条判据：`success:false`。
     * 四端的 `jsonResponseHandler` 只认这个字段才走 onError；没有它，拒绝会渲染成一条空回答，
     * 那比"报错"严重得多——用户会以为模型真的回答了空内容。
     */
    xSdk错误通道可用: {
        got: JSON.stringify([...new Set(rejected.map(r => `${r.success}/${r.sdkName}`))]),
        ok: rejected.length === 0 || rejected.every(r => r.success === false && r.sdkName === 'ConcurrencyLimited'),
    },
    没有异常: {got: errored.length, ok: errored.length === 0},
    中途读数确实看到在途: {got: `active=${midStats.active}`, ok: Number(midStats.active) === expectAdmitted},
    /** 在途中就要能判平：只在收尾判平的哨兵发现不了"越用越紧" */
    中途账平: {got: `accountingGap=${midStats.accountingGap}`, ok: Number(midStats.accountingGap) === 0},
    收尾格子清零: {got: `active=${endStats.active}, accountingGap=${endStats.accountingGap}, overRelease=${endStats.overRelease}`,
        ok: Number(endStats.active) === 0 && Number(endStats.accountingGap) === 0 && Number(endStats.overRelease) === 0},
    拒绝计数落地: {got: `rejected=${endStats.rejected}`, ok: Number(endStats.rejected) === FANOUT - expectAdmitted},
}
const allOk = Object.values(checks).every(c => c.ok)
log('判定', {
    各条: checks,
    结论: allOk
        ? `✅ 闸真挡得住：${admitted.length} 条进流（limit=${LIMIT}, perUser=${PER_USER}, multiUser=${MULTI_USER}）、`
            + `其余 ${rejected.length} 条在 SSE 头之前就被拒（HTTP 200 + code 4290 + success:false + Retry-After）；`
            + '在途期间 accountingGap=0，收尾后 active / overRelease 归零（说明每条进流的都在 finally 里注销了）'
        : `❌ 有不符合预期的项，见上面各条读数——特别是"收尾格子清零"若为假，就是只进不出，症状会表现为整站逐渐变慢`,
})
process.exit(allOk ? 0 : 1)
