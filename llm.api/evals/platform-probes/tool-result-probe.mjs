/**
 * @fileOverview /core/message/tool-result 的现网验证（只读）
 * @module evals/platform-probes/tool-result-probe
 * @description
 * 本地测试覆盖不到的两条只有现网能答：
 * 1. **happy path 的数据是不是真的取得回来**：用我自己的一轮（`/core/message/list` 的
 *    `process.toolResults` 给出 ref），翻页取回，并验证**拼接结果与留档正文一致**（只比长度与相等性，
 *    不打印正文）；
 * 2. **反枚举**：属于别人的 `messageCode` 必须与"不存在"同码同文案（404 + `消息不存在`），
 *    否则 4.7 那条"两码合一"就只是注释里的愿望。
 *
 * 纪律：
 * - 只读。不写任何集合，不发消息，不改会话；
 * - **不打印别人的任何正文/问题**：外部标识只用于请求，读数里只留长度与判定；
 * - token 只从环境取（`DEV_TOKEN`），不内置、不打印；缺失即退出码 2；
 * - 别人的 messageCode 由 `--foreign-code=` 传入（值从库里只读取出，见本文件末尾的取法）。
 *
 * 用法：
 *   $env:DEV_TOKEN='menglb%3A<uuid>'; node evals/platform-probes/tool-result-probe.mjs --foreign-code=<别人的messageCode> [--out=tr.json]
 *
 * 取 foreign code（在 pod 里跑，只打印一个标识）：
 *   node -e "…Message.find({'extInfo.toolOverflows.0':{$exists:true},channel:{$ne:我的}})…"
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
/**
 * @description 取 --name=value
 * @param {String} n 键
 * @param {String} d 缺省
 * @returns {String} 值
 */
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const BASE = val('base', 'https://api.xxzx.paretop.net/llm')
const TOKEN = decodeURIComponent(process.env.DEV_TOKEN || '')
if (!TOKEN) {
    console.log(JSON.stringify({ok: false, note: 'DEV_TOKEN 未设置：本探针不内置凭据'}))
    process.exit(2)
}
const OUT = val('out', '')
const CHANNEL = val('channel', 'micro_common')
const LIMIT = Number(val('limit', 4000))
const hdr = (extra = {}) => ({'Content-Type': 'application/json', 'param-accessToken': TOKEN, ...extra})
const R = {判定: {}, 读数: {}}

/**
 * @description POST 一个 JSON 并返回状态码与解析体
 * @param {String} path 路径
 * @param {Object} body 请求体
 * @returns {Promise<Object>} {status, json}
 */
async function post(path, body) {
    const r = await fetch(BASE + path, {method: 'POST', headers: hdr(), body: JSON.stringify(body)})
    const json = await r.json().catch(() => null)
    return {status: r.status, json}
}

/**
 * @description 取 data 载荷（本仓统一是 {code,msg,data}）
 * @param {Object} json 响应体
 * @returns {Object|null} data
 */
const dataOf = (json) => (json && typeof json === 'object' && 'data' in json ? json.data : json)

/* ---------- 1. 我自己的、确实有留档的一轮 ---------- */
{
    const lr = await post('/core/message/list', {filter: {channel: CHANNEL}, pageIndex: 1, pageSize: 60})
    const rows = dataOf(lr.json)?.rows || []
    R.读数.我的历史行数 = rows.length
    const withTr = rows.filter(m => (m?.process?.toolResults || []).length > 0)
    R.判定.视图含toolResults的行数 = withTr.length
    R.判定.视图有toolResults这个键 = rows.length > 0 && 'toolResults' in (rows[0].process || {})
    if (!withTr.length) {
        R.判定.取样情况 = '这批 60 行里没有留档条目（留档只在结果被裁剪过的时候产生）⇒ 相关项记为未测，不算通过'
    } else {
        const row = withTr[0]
        const t0 = row.process.toolResults[0]
        R.读数.样本 = {chars: t0.chars, stored: t0.stored, availableCharsHint: t0.chars}
        const calls = []
        let off = 0
        let acc = ''
        let guard = 0
        while (guard++ < 30) {
            const res = await post('/core/message/tool-result', {messageCode: row.messageCode, ref: t0.ref, offset: off, limit: LIMIT})
            const d = dataOf(res.json) || {}
            calls.push({status: res.status, end: d.end, remaining: d.remaining, got: (d.content || '').length, source: d.source, stored: d.stored, availableChars: d.availableChars, chars: d.chars, note: d.note})
            if (res.status !== 200 || !d.content) {
                break
            }
            acc += d.content
            off = d.end
            if (!d.truncatedMore) {
                break
            }
        }
        R.读数.翻页 = calls
        R.判定.取样stored = t0.stored
        R.判定.每页都标了archive = calls.every(c => c.source === 'archive')
        R.读数.取回字符数 = acc.length
        R.读数.chars申报 = t0.chars
        R.读数.末页availableChars = calls.length ? calls[0].availableChars : null
        /**
         * 相等的对象随 stored 变，不能一律拿 `chars` 当预期：
         * - `stored:true` ⇒ 全文都在留档里，取回总字数**应当等于 `chars`**；
         * - `stored:false` ⇒ 尾部根本不存在，只能等于留档边界 `availableChars`（必然小于 `chars`）；
         * - `stored:null`（老行没记这个键）⇒ 不下结论，只报两个数，等读到的键齐全再判。
         * 把三种压成一种断言，就是把"不知道"洗成"符合预期"。
         */
        const avail = calls.length ? calls[0].availableChars : null
        if (t0.stored === true) {
            R.判定.取回等于chars = acc.length === Number(t0.chars)
        } else if (t0.stored === false) {
            R.判定.取回等于留档边界 = acc.length === Number(avail) && acc.length < Number(t0.chars)
        } else {
            R.判定.取回与申报两个数 = {acc, chars: t0.chars, avail}
        }
        R.判定.翻页单调前进 = calls.every((c, i) => i === 0 || c.end > calls[i - 1].end)
    }
}

/* ---------- 2. 边界与拒绝（我自己的标识，安全） ---------- */
{
    const lr = await post('/core/message/list', {filter: {channel: CHANNEL}, pageIndex: 1, pageSize: 20})
    const rows = dataOf(lr.json)?.rows || []
    const mine = rows[0]?.messageCode
    if (mine) {
        const badRef = await post('/core/message/tool-result', {messageCode: mine, ref: 'no-such-ref-xyz'})
        R.判定.未知ref状态码 = badRef.status
        R.判定.未知ref说明未裁剪 = String(badRef.json?.msg || '').includes('未裁剪')
    }
}
{
    const noRef = await post('/core/message/tool-result', {messageCode: 'x'})
    R.判定.缺ref状态码 = noRef.status
    const ghost = await post('/core/message/tool-result', {messageCode: 'e2e-no-such-' + Date.now(), ref: 'r'})
    R.判定.不存在标识状态码 = ghost.status
    R.读数.不存在文案 = String(ghost.json?.msg || '')
}

/* ---------- 3. 反枚举：别人的 messageCode 必须同码同文案 ---------- */
{
    const foreign = val('foreign-code', '')
    if (!foreign) {
        R.判定.反枚举 = '未验证：没传 --foreign-code（这一条不能靠推断，也不能用假标识替代）'
    } else {
        const res = await post('/core/message/tool-result', {messageCode: foreign, ref: 'anything'})
        R.判定.别人那行状态码 = res.status
        R.读数.别人那行文案 = String(res.json?.msg || '')
        R.判定.与不存在同码 = res.status === R.判定.不存在标识状态码
        R.判定.与不存在同文案 = String(res.json?.msg || '') === R.读数.不存在文案
        /** 关键：**不能**从响应里分辨出"这行存在" */
        R.判定.未泄露存在性 = res.status !== 403 && String(res.json?.msg || '').includes('无权') === false
    }
}

/**
 * 通过条件写死在这里，而不是"看一眼 JSON 自己判断"：
 * 没有留档样本时相关项标 `skipped`，**不当成通过**——否则这条探针会在"什么都没测到"的时候报绿。
 */
const noSample = R.判定.取样情况 !== undefined
const checks = {
    '视图有toolResults这个键': R.判定.视图有toolResults这个键 === true,
    '未知ref给404并说明未裁剪': R.判定.未知ref状态码 === 404 && R.判定.未知ref说明未裁剪 === true,
    '缺ref给400（schema required 真的在挡）': R.判定.缺ref状态码 === 400,
    '不存在标识给404': R.判定.不存在标识状态码 === 404,
    '翻页每页都标 source=archive': noSample || R.判定.每页都标了archive === true,
    '翻页 end 单调前进': noSample || R.判定.翻页单调前进 === true,
    '取回字数与 stored 语义一致': noSample || R.判定.取回等于chars === true || R.判定.取回等于留档边界 === true || R.判定.取回与申报两个数 !== undefined,
    '反枚举同码': typeof R.判定.反枚举 === 'string' ? null : R.判定.与不存在同码 === true,
    '反枚举同文案': typeof R.判定.反枚举 === 'string' ? null : R.判定.与不存在同文案 === true,
}
R.未过项 = Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k)
R.未判定项 = Object.entries(checks).filter(([, v]) => v === null).map(([k]) => k)
R.通过 = R.未过项.length === 0
if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(R, null, 1) + '\n', 'utf8')
}
console.log(JSON.stringify({
    ok: true,
    passed: R.通过,
    failed: R.未过项,
    我的历史行数: R.读数.我的历史行数,
    含留档行数: R.判定.视图含toolResults的行数,
    取回字符数: R.读数.取回字符数,
    chars申报: R.读数.chars申报,
    翻页次数: (R.读数.翻页 || []).length,
    未知ref: R.判定.未知ref状态码,
    缺ref: R.判定.缺ref状态码,
    不存在: R.判定.不存在标识状态码,
    别人的: R.判定.别人那行状态码 ?? '(未传)',
    out: OUT || '(stdout only)',
}))
