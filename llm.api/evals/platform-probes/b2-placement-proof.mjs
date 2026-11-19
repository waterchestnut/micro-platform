/**
 * @fileOverview B2 `'tools'` 分支的取证：让**真档案 + 真判据函数**而不是单测夹具说话
 * @module evals/platform-probes/b2-placement-proof
 * @description
 * 审计项 B2 的判据是两件事：`modelCallNote`（要不要说、说什么）与 `modelCallPlacement`（挂在哪）。
 * 后者有两条分支，此前只有 `'standalone'` 在真实数据上被验证过。2026-11-13 先把发生率量清楚：
 * dev 全库 1441 行里"两个数都有值"780 行，"不等"只有 **9 行**，形状仅 `iterationCount=1/modelCalls=3`
 * 与 `1/2` 两种；其中**真实流量那 7 行全是零工具**（所以只会走 `standalone`），
 * "不等且有工具"的 2 行全是探针行 ⇒ **真实流量从未产生过 `'tools'` 这一形状**。
 *
 * 为什么不等会发生（这条是实测出来的，不是推测）：
 * - **SDK 层的重试不进 `modelCalls`**：给假中继加 `--failFirst=2` 后，中继被打了 4 次（含两次 503），
 *   而档案仍是 `iterationCount=2 / modelCalls=2` ⇒ 默认配置（`upstreamRetry.enabled` 不为 true）下
 *   重试根本不会让这两个数不等；
 * - **成功的无工具收尾补落也不会**：它同时给 `iterationCount` 与 `modelCalls` 各 +1 ⇒ 相等 ⇒ B2 沉默（正确）；
 * - 真正会不等且有工具的是**收尾补落被打断**那一类：那次调用计进 `modelCalls`，但轮次没加 ⇒
 *   `1 / 2` + 工具 1 条 ⇒ 恰好是 `'tools'` 分支。
 *
 * 所以取证顺序是"对已存在的真档案核对判据"，而不是改配置凑一个形状出来：
 * `--conversation=CC` 走**视图**（`/core/message/list`）取回 `process`，
 * 再交给前端母本 `segments.ts` 的那两个函数（`--experimental-strip-types` 直接 import，不复制判据）。
 *
 * 用法（在 `src/` 下）：
 *   # 只读取证（推荐，零 token）
 *   $env:PORT=12028; $env:LLM_RELAY_BASE_URL='http://127.0.0.1:13028/v1'; node server.js
 *   $env:PROBE_BASE='http://127.0.0.1:12028'
 *   node --experimental-strip-types evals/platform-probes/b2-placement-proof.mjs --conversation=<会话码>
 *   # 造形状（装置自检用；注意成功补落会让两数相等，所以它证明的是"沉默正确"而不是"分支可达"）
 *   node evals/platform-probes/fake-relay-abort.mjs --port=13028 --rounds=2 --delay=200 --finalizeDelay=200
 *   node --experimental-strip-types evals/platform-probes/b2-placement-proof.mjs --maxIterations=1
 *
 * 判据（只读模式）：视图里 `iterationCount` 与 `usage.modelCalls` 都 >0 且**不相等**、
 * `toolCalls.length > 0`，且 `modelCallPlacement(process, toolCalls.length) === 'tools'`、
 * `modelCallNote(process)` 非空。两者相等时判定为"未通过"是**正确的**——B2 的设计就是相等不说，
 * 所以我专门拿一行相等的档案当对照（`loopExit=aborted:rescue` 那行，note/placement 皆空）。
 */
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const argv = process.argv.slice(2)
/**
 * @description 取 --name=value
 * @param {String} n 键
 * @param {String} d 缺省
 * @returns {String} 结果
 */
function val(n, d) {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:12028'
/**
 * `--conversation=CC`：**只读模式**，不再打新的流，直接对库里已有的一行做判据核对。
 * 加这个模式的原因：2026-11-13 实测 `iterationCount=2 / modelCalls=2` 而中继被打了 4 次
 * ⇒ **SDK 层的重试不会进 `modelCalls`**，所以"有工具 + 两者不等"在默认配置（重试层关）下
 * 靠重试是造不出来的；能造出这个形状的其实是**收尾补落被打断**那一类（现网已有行）。
 * 于是正确的取证顺序是：先对**已经存在的那一行**核对判据，而不是为了形状去改配置凑数。
 */
const READONLY = val('conversation', '')
/** 前端母本的位置：默认按同 workspace 的兄弟仓推，可用环境变量覆盖，不写死某台机器 */
const SEGMENTS = process.env.PROBE_SEGMENTS
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../xxzx.console/src/chatProviders/segments.ts')
const ui = Buffer.from(JSON.stringify({userCode: 'menglb', realName: 'B2 取证'})).toString('base64')
const cc = READONLY || `b2tools-${Date.now()}`

const ac = new AbortController()
const timer = setTimeout(() => ac.abort(), 120000)
const st = {帧: 0, done: false, err: null}
if (!READONLY) {
try {
    const res = await fetch(`${BASE}/core/chat/stream`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', 'user-info': ui},
        body: JSON.stringify({
            query: '必须先调用工具检索记忆，再根据检索结果给结论。',
            conversationCode: cc,
            options: {channel: 'micro_common', protocol: 2, cache: false, maxIterations: Number(val('maxIterations', 1))},
        }),
        signal: ac.signal,
    })
    const dec = new TextDecoder()
    let buf = ''
    for await (const cv of res.body) {
        buf += dec.decode(cv, {stream: true})
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
            const f = buf.slice(0, i); buf = buf.slice(i + 2)
            st.帧++
            if (/event:done/.test(f)) st.done = true
        }
    }
} catch (e) {
    st.err = String((e && e.message) || e).slice(0, 60)
}
clearTimeout(timer)
console.log(JSON.stringify({客户端: st}))
}

/** 视图取回（不是自己拼对象）：装配清单是否真的把这两个数送到了界面，只有这一层能证明 */
const list = await (await fetch(`${BASE}/core/message/list`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'user-info': ui},
    body: JSON.stringify({filter: {conversationCode: cc}, pageIndex: 1, pageSize: 10, options: {sort: {insertTime: -1}}}),
})).json()
/**
 * 视图的行在 `data.rows`（`getMessagePage` 返回 `{total, rows}`，被 format-reply 包进 `data`）。
 * 这里写得宽容一点并**把形状本身打出来**：第一次跑就因为我按 `data.list` 取，
 * 拿到 0 行，差点把它读成"这条档案没落库"——那又是"仪器没通电时的读数"。
 */
const d = (list && list.data) || {}
const arr = Array.isArray(d.rows) ? d.rows : (Array.isArray(d.list) ? d.list : [])
console.log(JSON.stringify({响应形状: {顶层键: Object.keys(list || {}), data键: Object.keys(d), total: d.total, 行数: arr.length, success: list && list.success}}))
const withProc = arr.filter(r => r && r.process)
const p = withProc.length ? withProc[0].process : null
const out = {
    视图行数: arr.length,
    有process的行数: withProc.length,
    progress: withProc.length ? withProc[0].progress : null,
    iterationCount: p ? p.iterationCount : null,
    modelCalls: p && p.usage ? p.usage.modelCalls : null,
    hasUsage: p && p.usage ? p.usage.hasUsage : null,
    工具调用条数: p && Array.isArray(p.toolCalls) ? p.toolCalls.length : null,
    loopExit: p ? p.loopExit : null,
    forcedFinal: p ? p.forcedFinal : null,
    段类型: p && Array.isArray(p.segments) ? p.segments.map(s => s.kind).join('>') : null,
}
console.log(JSON.stringify({视图: out}))

if (!p) {
    console.log('判定：未通过——视图里没有带 process 的行（这条档案根本没读出来，谈不上分支）')
    process.exit(3)
}
const m = await import(new URL('file:///' + SEGMENTS.replace(/\\/g, '/')).href)
const note = m.modelCallNote(p)
const placement = m.modelCallPlacement(p, (p.toolCalls || []).length)
console.log(JSON.stringify({母本判据: {note, placement}, 用的母本: SEGMENTS.slice(-40)}))
const shape = out.iterationCount !== null && out.modelCalls !== null
    && out.iterationCount > 0 && out.modelCalls > 0 && out.modelCalls !== out.iterationCount
const ok = shape && (out.工具调用条数 || 0) > 0 && placement === 'tools' && note !== ''
console.log(JSON.stringify({
    成因判断: {
        形状不等: shape,
        sdk重试会不会进modelCalls: '不会——实测中继被打 4 次（含 2 次 503）而 modelCalls=2（重试层关着）',
        谁会分开这两个数: '我们自己的重试层（upstreamRetry.enabled=true，每次尝试都 trackCall）'
            + '；实测开启后 iter=2 / calls=3 / 工具=1 ⇒ placement=tools、note="上游模型实际调用 3 次"',
        成功补落会不会: '不会——它给两个数各 +1 ⇒ 相等 ⇒ 按设计沉默；只有"补落被打断"才只加 calls',
    },
}))
console.log('判定：' + (ok
    ? `通过：真档案经视图回填后落到 'tools'（note="${note}"，iter=${out.iterationCount} calls=${out.modelCalls} 工具=${out.工具调用条数}）`
    : `未通过：placement=${placement || '(空)'} note="${note}" iter=${out.iterationCount} calls=${out.modelCalls} tools=${out.工具调用条数}`
    + '（相等=按设计不说，不是缺陷；不等但 placement 为空=视图没给工具条数，那才是接线漏）'))
process.exit(ok ? 0 : 3)
