/**
 * @fileOverview 观察周的 extInfo.gate 分布读数仪（enforce 之议与 §13 拦截率的共同输入）
 * @module evals/gate/gateWeekRead
 * @description
 * 观察档一周（gate_enabled=true, enforce=false）攒下的裁决怎么读，这份仪器就是答案：
 *   - **applied/verdict/source 分布**：门在真流量上会拦什么、短路在哪层；
 *   - **enforce 反事实**（§13 的拦截率读数）：`verdict ∈ {block, await-human}` 的条数——
 *     "如果 enforce=true，这些动作不会被直接执行"，观察模式本身一个不拦，这个数字正是
 *     enforce 之议的第一输入（1846 行裁定：开闸≠覆盖，拦截率归门那刀）；
 *   - **overrode 计数**：硬规纠正分类器放行的次数（unknown 面那 3/3 实证规则的现网回归）；
 *   - **身份分栏**：natural vs synthetic——判据**单源复用 `sampleCorpus.syntheticReason`**
 *     （主=userCode 次=前缀），词表分家的老规矩；自然流量薄（60 天 3 调用），分母薄这件事
 *     本身要作为读数报告出来（`分母提示`），不许让 probe 流量冒充自然分布。
 *   - **姿态混检**：窗口内若出现 enforce=true 的档案（中途翻闸），单独计数并声明——
 *     反事实口径在混合姿态下不成立，报告必须自己说出来。
 * 用法（src/ 下）：node evals/gate/gateWeekRead.mjs [--days=7]
 */
import {syntheticReason} from './sampleCorpus.mjs'

/**
 * @description 从带 extInfo.gate 的档案数组出观察周报告（纯函数——输入形状=档案面读到的形状）
 * @param {Array<Object>} docs [{conversationCode, userCode, insertTime, extInfo:{gate}}]
 * @returns {Object} 分布/反事实/纠正/分栏读数
 */
export function buildGateWeekReport(docs = []) {
    const bump = (o, k) => { o[k] = (o[k] || 0) + 1 }
    const rep = {
        nMessages: docs.length,
        nDecisions: 0,
        applied: {}, verdict: {}, source: {},
        overrode: 0,
        反事实_enforce下不直接执行: 0,
        反事实_明细: {block: 0, 'await-human': 0},
        分栏: {natural: {messages: 0, decisions: 0}, synthetic: {messages: 0, decisions: 0}},
        合成排除计数: {},
        topTools: {},
        按天: {},
        姿态混检: {observedOnly: 0, withEnforce: 0},
    }
    for (const d of docs) {
        const g = d?.extInfo?.gate
        const ds = (g && g.decisions) || []
        if (!ds.length) continue
        if (g.enforce === true) rep.姿态混检.withEnforce++
        else rep.姿态混检.observedOnly++
        const why = syntheticReason(d?.conversationCode || '', d?.operator?.userCode || d?.userCode || '')
        if (why) rep.合成排除计数[why] = (rep.合成排除计数[why] || 0) + 1
        const side = why ? 'synthetic' : 'natural'
        rep.分栏[side].messages++
        rep.分栏[side].decisions += ds.length
        const day = new Date(d.insertTime || Date.now()).toISOString().slice(0, 10)
        rep.按天[day] = (rep.按天[day] || 0) + ds.length
        for (const x of ds) {
            rep.nDecisions++
            bump(rep.applied, x.applied || '(缺)')
            bump(rep.verdict, x.verdict || '(缺)')
            bump(rep.source, x.source || '(缺)')
            bump(rep.topTools, x.tool || '(缺)')
            if (x.overrode === true) rep.overrode++
            if (x.verdict === 'block' || x.verdict === 'await-human') {
                rep.反事实_enforce下不直接执行++
                bump(rep.反事实_明细, x.verdict)
            }
        }
    }
    rep.分母提示 = rep.分栏.natural.decisions === 0
        ? '自然面零决策——本报告全部来自探针/跑批身份；分布类结论按此打折（语料翻案的同款提醒）'
        : `自然面 ${rep.分栏.natural.decisions} 条 / 合成面 ${rep.分栏.synthetic.decisions} 条`
    return rep
}

/** CLI 直接执行才跑（被 import 不触发——与 bench 同一家规） */
if (process.argv[1] && process.argv[1].endsWith('gateWeekRead.mjs')) {
    await import(new URL('../../init.js', import.meta.url).href)
    const days = Number((process.argv.find((a) => a.startsWith('--days=')) || '--days=7').slice(7))
    const {Message} = await import(new URL('../../daos/core/schema/index.js', import.meta.url).href)
    const since = new Date(Date.now() - days * 86400000)
    const docs = await Message.find(
        {insertTime: {$gte: since}, 'extInfo.gate': {$exists: true, $ne: null}},
        {conversationCode: 1, 'operator.userCode': 1, insertTime: 1, 'extInfo.gate': 1},
    ).sort({insertTime: -1}).limit(3000).lean()
    const rep = buildGateWeekReport(docs)
    rep.window = {days, 取数: docs.length}
    console.log(JSON.stringify(rep, null, 1))
    process.exit(0)
}

export default {buildGateWeekReport}
