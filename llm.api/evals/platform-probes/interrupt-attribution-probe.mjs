/**
 * @fileOverview 中断归因探针：客户端断开后，档案里这一行是由哪条落库点写下的、来源是什么
 * @module evals/platform-probes/interrupt-attribution-probe
 * @description
 * 起因（2026-11-12 的取证）：dev 里有 2 行 `extInfo.interruptedBy = 'unspecified'`，
 * 签名是 `progress:'abort'` + `writtenBy:'error'` + 错误文本 `abort:Request was aborted.`
 * ⇒ 错误路径（`PERSIST_VIA.ERROR`）当时没传来源。修法是把兜底从写死标签改成现场计算
 * （源仓 `6f5154c`、底座 `e440c0f`）。本探针负责回答"修完之后到底走哪条路"。
 *
 * 三种断开方式实测**不等价**，这是本文件存在的核心理由：
 * - `signal`：`AbortController.abort()` 硬断 TCP（`error-path.mjs` 用的就是这种）；
 * - `stream`：`reader.cancel()` 软取消读取；
 * - `await`：把上游首字节人为推迟（需自带假中继），断在 `await` 里。
 * 2026-11-12 实测：三种方式**全部**落在 `aborted:loop-exit`（drain 里的停判据把断开礼貌接走，
 * 服务端日志无 `主循环异常`），所以"错误路径的 abort"在现网**不能按需复现**，
 * 那 2 行遗留档案属 PR-E0.5 之前的形态。
 * ⇒ 结论要诚实：可复现路径的归因已被现场验证（本探针），
 *   错误路径的归因只有源码级不变量 + 负向对照撑着，**没有现场样本**。
 *
 * 判据（只读档案元数据，不读正文）：
 * - `progress` 必须是 `abort`（正常收尾说明没断开成功）；
 * - `writtenBy` 告诉你是哪条落库点写的（`loop-exit` / `loop-entry` / `error` / `unattributed` / `rescue`）；
 * - `interruptedBy` 必须非空且不等于 `unspecified`；
 * - 全库 `unspecified` 行数不得因本次探测增加。
 *
 * 用法（服务要先起来，`src/` 下）：
 *   # 真实上游，请求起来后硬断（会产生一次被中途打断的生成）
 *   $env:PORT=12008; node server.js
 *   node evals/platform-probes/interrupt-attribution-probe.mjs --mode=signal --abortAfter=1500
 *   # 软取消读取
 *   node evals/platform-probes/interrupt-attribution-probe.mjs --mode=stream --afterDeltas=3
 *   # 假中继（不消耗真实 token，确定性强）：见 fake-relay-abort.mjs 的用法
 *   node evals/platform-probes/fake-relay-abort.mjs --port=13011 --delay=6000 --rounds=2
 *   $env:PORT=12012; $env:LLM_RELAY_BASE_URL='http://127.0.0.1:13011/v1'; node server.js
 *   $env:FAKE='1'; $env:PROBE_BASE='http://127.0.0.1:12012'; node evals/platform-probes/interrupt-attribution-probe.mjs --mode=await
 *   # 实测（2026-11-12）：rounds=2 的那一枪落进 writtenBy='error'，
 *   # 且 interruptedBy 是 client-disconnect —— 这就是修复的现场样本。
 *
 *   # 现网档：打 dev 网关（真实 pod 写出的行才算部署级证据），断在第一次 await
 *   PROBE_BASE=https://api.xxzx.paretop.net/llm node evals/platform-probes/interrupt-attribution-probe.mjs --mode=preawait --waitMs=400
 *   # 换环境要改两件事：频道（cw2pc 是 micro_common，写死 micro_common 会被 400 拒）
 *   # 与回读（远端自动只给客户端侧结论，档案侧用 incluster-attribution-census 在 pod 内读）
 *   CW_TOKEN=... PROBE_BASE=https://api-cw2pc.xxzx.paretop.net/llm DEV_TOKEN=<cw2pc token> \
 *     node evals/platform-probes/interrupt-attribution-probe.mjs --mode=preawait --waitMs=400 --channel=micro_common
 */
import fs from 'node:fs'
import {createRequire} from 'node:module'

const require2 = createRequire(import.meta.url)
const {MongoClient} = require2('mongodb')

const argv = process.argv.slice(2)
/**
 * @description 取命令行参数
 * @param {String} n 参数名（不含 --）
 * @param {String} def 缺省值
 * @returns {String} 结果
 */
function val(n, def) {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : def
}
const BASE = process.env.PROBE_BASE || `http://127.0.0.1:${val('port', '12008')}`
const MODE = val('mode', 'signal')
const ABORT_AFTER = Number(val('abortAfter', 1500))
const AFTER_DELTAS = Number(val('afterDeltas', 3))
const WAIT_MS = Number(val('waitMs', 2500))
/**
 * 网关档：打到 dev 现网（真实 pod 的镜像里跑出来的才是"部署级"证据）。
 * token 不在这里复制，从同目录的归档探针里读默认值，环境变量 DEV_TOKEN 优先。
 */
const IS_LOCAL = /(^|\/\/)(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(BASE)
/**
 * @description 取网关鉴权 token（本地档返回空串）
 * @returns {String} 结果
 */
function gatewayToken() {
    if (IS_LOCAL) {
        return ''
    }
    if (process.env.DEV_TOKEN) {
        return decodeURIComponent(process.env.DEV_TOKEN)
    }
    const sib = fs.readFileSync(new URL('./abort-archive-probe.mjs', import.meta.url), 'utf8')
    const hit = /val\('token',\s*'([^']+)'\)/.exec(sib)
    if (!hit) {
        throw new Error('无法从 abort-archive-probe.mjs 取到默认 token，请显式给 DEV_TOKEN')
    }
    return decodeURIComponent(hit[1])
}
const AUTH = gatewayToken()
/**
 * 频道按环境不同：dev 是 `micro_common`，cw2pc 是 `micro_common`（实测：拿 micro_common 打 cw2pc
 * 会被 400 拒绝"无效的频道…未在配置中定义"）。写死频道等于探针只能在 dev 用。
 */
const CHANNEL = val('channel', 'micro_common')
/**
 * 回读口径必须跟着目标环境走：本地服务连的是 dev 库，而**打到远端网关时，
 * 用本地配置去读 Mongo 会读到另一个库**，于是"没有落库行"是读错库、不是没落库
 * （2026-11-12 在 cw2pc 上就这么误判过一次）。远端档改为：客户端侧给结论，
 * 档案侧交给集群内探针 `incluster-attribution-census.mjs`。
 */
const READBACK = IS_LOCAL ? 'mongo' : 'client-only'
/**
 * 各档对"是否允许花真实上游"的约束：
 * - `await` 是离线复现档（假中继），必须 FAKE=1 且只允许打本地服务；
 * - `preawait` 是现网档：断在第一次上游调用的 await 里，**就是要花一点点真实流量**
 *   （提示词很短且中途掐断），用来拿"pod 写出的行"这个部署级证据。
 */
if (MODE === 'await' && process.env.FAKE !== '1') {
    console.log(JSON.stringify({判定: '拒绝执行：mode=await 需要 FAKE=1（确认 LLM_RELAY_BASE_URL 指向假中继）'}))
    process.exit(4)
}
if (MODE === 'await' && !IS_LOCAL) {
    console.log(JSON.stringify({判定: '拒绝执行：mode=await 只允许打本地服务（假中继）'}))
    process.exit(4)
}
const USER = {userCode: 'interrupt-attribution-probe', realName: '中断归因探针'}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const cc = `iat-${MODE}-${Date.now()}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @description 从 system.config 里取字符串常量（探针不复制连接串，避免凭据进脚本）
 * @param {RegExp} re 规则
 * @param {String} def 缺省
 * @returns {String} 结果
 */
function cfgStr(re, def) {
    const src = fs.readFileSync(new URL('../../conf/system.config.js', import.meta.url), 'utf8')
    return (re.exec(src) || [])[1] || def
}

/**
 * @description 跑一次流并按 MODE 断开
 * @returns {Object} 客户端侧观测（帧数、断开方式），不含正文
 */
async function runStream() {
    const ac = new AbortController()
    let deltas = 0
    let frames = 0
    let how = ''
    const res = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'user-info': b64(USER),
            /** 网关档才带鉴权头；本地档留空，避免把凭据塞进无关请求 */
            ...(AUTH ? {'param-accessToken': AUTH} : {}),
        },
        body: JSON.stringify({
            query: '请逐项详细展开"大模型网关过程可见性容易失真的五个环节"，每项三到四句，不要调用工具，直接开始写第一条。',
            conversationCode: cc,
            options: {channel: CHANNEL, protocol: 3, cache: false},
        }),
        signal: ac.signal,
    })
    /**
     * 网关用 JSON 报错时（例如"无效的频道"400），流会"自然结束"——
     * 那**不是"没断成功"，是请求根本没进模型**。上一版把它读成了"没有落库行"，
     * 让我误判成修复没生效；这里必须把它分开报。
     */
    const ctype = res.headers.get('content-type') || ''
    if (!/event-stream/.test(ctype)) {
        const body = await res.text().catch(() => '')
        const code = (/"code":\s*"?([\w-]+)"?/.exec(body) || [])[1] || null
        const msg = (/"msg":\s*"([^"]{0,48})/.exec(body) || [])[1] || null
        return {how: `响应不是 SSE（status=${res.status}, code=${code}, msg=${msg}）⇒ 请求没进模型`, frames: 0, deltas: 0, fatal: true}
    }
    const t0 = Date.now()
    const reader = res.body.getReader()
    while (Date.now() - t0 < 120000) {
        const p = await Promise.race([reader.read(), sleep(500).then(() => ({quiet: true}))])
        if (p.quiet) {
            /**
             * `await`（假中继）与 `preawait`（现网）走同一个物理条件：
             * 首帧已到、正文一个都没来、且已等过 WAIT_MS ⇒ 服务端正卡在 await 上游调用里。
             * 现网档把 WAIT_MS 压到几百毫秒就够（真实 relay 的首 token 通常 1s 开外）。
             */
            if ((MODE === 'await' || MODE === 'preawait') && deltas === 0 && Date.now() - t0 >= WAIT_MS) {
                how = `${MODE}（${WAIT_MS}ms 无正文）`
                ac.abort()
                break
            }
            if (MODE === 'signal' && Date.now() - t0 >= ABORT_AFTER) {
                how = `signal（${ABORT_AFTER}ms 硬断）`
                ac.abort()
                break
            }
            continue
        }
        if (p.done) {
            how = '流自然结束（没断成功）'
            break
        }
        if (p.value) {
            const s = Buffer.from(p.value).toString('utf8')
            frames += (s.match(/\n\n/g) || []).length
            deltas += (s.match(/event:delta/g) || []).length
            if (MODE === 'stream' && deltas >= AFTER_DELTAS) {
                how = `stream（第 ${AFTER_DELTAS} 个 delta 后 reader.cancel）`
                await reader.cancel().catch(() => {})
                break
            }
        }
    }
    /** 给落库留余量：persistTurn 在中断被观察到之后才执行 */
    await sleep(6000)
    return {how, frames, deltas}
}

/**
 * @description 读回这一行的归因字段
 * @returns {Object} 判定用的小结构
 */
async function readBack() {
    const uri = (process.env.MONGO_URI || 'mongodb://x')
        .replace(/^mongodb:\/\//, `mongodb://${(process.env.MONGO_USER || '')}:${(process.env.MONGO_PASS || '')}@`)
    const client = await MongoClient.connect(uri, {serverSelectionTimeoutMS: 15000})
    try {
        const db = client.db((process.env.MONGO_DB || 'llm-api'))
        const row = await db.collection('message').findOne({conversationCode: cc}, {projection: {progress: 1, error: 1, extInfo: 1}})
        const e = (row && row.extInfo) || {}
        return {
            found: !!row,
            progress: row ? row.progress : null,
            writtenBy: e.writtenBy || null,
            interruptedBy: e.interruptedBy === undefined ? '(无键)' : e.interruptedBy,
            loopExit: e.loopExit || null,
            errorKind: row && row.error ? String(row.error).split(':')[0] : null,
            iterationCount: e.iterationCount ?? null,
            modelCalls: (e.usage && e.usage.modelCalls) ?? null,
            unspecifiedTotal: await db.collection('message').countDocuments({'extInfo.interruptedBy': 'unspecified'}),
        }
    } finally {
        await client.close()
    }
}

const seen = await runStream()
if (seen.fatal) {
    console.log(JSON.stringify({mode: MODE, conversationCode: cc, 客户端: seen, 判定: '失败：请求根本没进模型（先看频道/鉴权，再谈归因）'}, null, 1))
    process.exit(5)
}
/**
 * 远端档不做本地库回读（读错库会得出"没有落库行"的假失败）；
 * 档案侧交给 `incluster-attribution-census.mjs`，它跑在目标 pod 里、连的是那个环境的库。
 */
if (READBACK === 'client-only') {
    const interrupted = /preawait|await|signal|硬断|无正文/.test(seen.how || '')
    console.log(JSON.stringify({
        mode: MODE,
        conversationCode: cc,
        客户端: seen,
        回读: '跳过（目标是远端网关，本地 Mongo 读的是另一个库）',
        下一步: `在目标 pod 内跑 incluster-attribution-census 并按会话号核对：${cc}`,
        判定: interrupted ? '客户端侧已按预期断开；档案侧结论等集群内读数，不在此处宣称' : `无结论：断开没成功（${seen.how}）`,
    }, null, 1))
    process.exit(interrupted ? 0 : 3)
}
const row = await readBack()
/**
 * 判定：归因是否存在（这才是本次要验的东西）；
 * 另外单独报"走的是哪条落库点"，因为**只有 error 那条才是本次修复的对象**，
 * 落在 loop-exit 上说明这一枪没测到修复本身（不是失败，是无结论）。
 */
const attributed = row.found && row.progress === 'abort' && row.interruptedBy && row.interruptedBy !== 'unspecified'
console.log(JSON.stringify({
    mode: MODE,
    conversationCode: cc,
    客户端: seen,
    档案: row,
    判定: !row.found ? '失败：没有落库行'
        : row.progress !== 'abort' ? `无结论：progress=${row.progress}，断开没成功或收尾正常`
            : attributed ? (row.writtenBy === 'error' ? '通过：错误路径的 abort 带上了真实来源' : `通过（但不是本次修复的路径）：${row.writtenBy} 本来就带来源`)
                : `失败：来源=${JSON.stringify(row.interruptedBy)}`,
}, null, 1))
process.exit(row.found && row.progress === 'abort' && attributed ? 0 : 3)
