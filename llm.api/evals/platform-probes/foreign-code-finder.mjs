/**
 * @fileOverview 为 tool-result 探针找一条"不属于我"的 messageCode（只读，且只打印标识与量级）
 * @module evals/platform-probes/foreign-code-finder
 * @description
 * 反枚举那条判定需要一个真实的、属于别人的 messageCode。本地测试造不出来（造出来就是假数据），
 * 所以这里从库里只读地取一个，**只打印标识与字符数量级，绝不打印正文、问题、用户标识**。
 * 用法（在 pod 里）：node evals/platform-probes/foreign-code-finder.mjs --mine=menglb
 */
/**
 * 与既有探针同一写法：**先 `init.js` 再动态 import daos**——
 * 静态 import 会在 `llm` 全局就位之前执行，报的是"读不到配置/连不上库"那一类怪错，
 * 而不是真实原因（`daos/core/schema/index.js` 顶层 await createConnection）。
 */
await import('../../init.js')
const {Message} = await import('../../daos/core/schema/index.js')

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
const MINE = val('mine', 'menglb')

/** 先确认"我"在库里到底叫什么：operator.userCode 的确切值不能靠 token 前缀猜 */
const mineProbe = await Message.find({'extInfo.toolOverflows.0': {$exists: true}}).sort({insertTime: -1}).limit(40).lean().exec()
const owners = new Set(mineProbe.map(r => r?.operator?.userCode ?? '(无operator)'))
console.log(JSON.stringify({
    note: 'owner 取值集合（只为确认我的标识写法，不含正文）',
    owners: [...owners].map(o => (o === MINE ? '匹配mine' : `长度${String(o).length}`)),
    含mine: owners.has(MINE),
}))

const foreign = mineProbe.filter(r => (r?.operator?.userCode ?? '') !== MINE && r?.extInfo?.toolOverflows?.length)
if (!foreign.length) {
    console.log(JSON.stringify({ok: false, note: '最近 40 条有留档的行都属于我，无法取到外部样本 ⇒ 反枚举那条只能记为未验证'}))
    process.exit(0)
}
const pick = foreign[0]
const first = pick.extInfo.toolOverflows[0]
console.log(JSON.stringify({
    ok: true,
    messageCode: pick.messageCode,
    ref: first.ref ?? first.tool_call_id ?? null,
    /** 只给量级：探针要用来核对"两码合一"，不需要内容 */
    chars: first.chars ?? null,
    stored: first.stored ?? null,
    insertTime: pick.insertTime,
    别人样本数: foreign.length,
}))
process.exit(0)
