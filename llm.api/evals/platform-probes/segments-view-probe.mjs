/**
 * @fileOverview 历史视图里 `process.segments` 的真实形状与"空气泡"规模（只读）
 * @module evals/platform-probes/segments-view-probe
 * @description
 * 要回答两个问题，它们决定 PR-G 先做哪一半：
 *
 * 1. **前端从 `/core/message/list` 的视图里到底收不收得到 `segments`？**
 *    不收得到，段渲染就无从谈起；收得到但字段名/形状与我写进 `docs/api/chat-sse.md` 的不一致，
 *    那文档就是在误导四端。判据必须走 `toMessageView`（视图函数本身），而不是直接读库字段——
 *    "库里有"与"前端看得到"是两件事，这个区别本仓已经吃过一次（`writtenBy` 在库里、不在视图里）。
 *
 * 2. **有多少条历史轮次在前端只能渲染成一条空气泡？**
 *    `progress:"abort"` 且 `answerContent` 为空、文字全在 `segments` 里的轮次就是这种：
 *    数量决定"段渲染是必要件还是体验增强"这句话值多少优先级。
 *
 * 只读：不写任何集合，不打印问题正文（只给长度与形状）。
 *
 * 用法（在 pod 里跑）：
 *   node evals/platform-probes/segments-view-probe.mjs [--limit=200] [--out=/tmp/seg.jsonl]
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
/**
 * @description 取 --name=value 参数
 * @param {String} n 键
 * @param {String} d 缺省
 * @returns {String} 值
 */
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const LIMIT = Number(val('limit', 200))
const OUT = val('out', '')
const LINES = []

/**
 * @description 自己落文件再打印（中文键名不经 PowerShell 重定向，免得读数被编码弄坏）
 * @param {String} note 事件
 * @param {Object} obj 字段
 * @returns {void}
 */
function log(note, obj = {}) {
    const line = JSON.stringify({probe: 'segments-view', note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}

await import('../../init.js')
const {Message} = await import('../../daos/core/schema/index.js')
const {toMessageView} = await import('../../services/core/message.js')

/**
 * @description 统计一段样本的视图形状
 * @param {Object} q mongo 查询条件
 * @param {String} label 口径名
 * @returns {Promise<Object>} 读数
 */
async function summarize(q, label) {
    /** 统一加上"只要助手应答行"的口径，否则 u2u/通知行会把空 answer 数量虚高 */
    const rows = await Message.find({...q, ...ASSISTANT}).sort({insertTime: -1}).limit(LIMIT).lean().exec()
    let withSegments = 0
    let emptyAnswer = 0
    let emptyAnswerButSegments = 0
    let emptyAnswerUnrescuable = 0
    let droppedSeen = 0
    const kindCount = {}
    const samples = []
    for (const row of rows) {
        /** 走视图函数：前端拿到什么才算什么 */
        const view = toMessageView(row)
        const segs = view?.process?.segments || []
        /** 视图里的正文字段叫 `answer`（不是库里的 answerContent），照真名取 */
        const answer = view?.answer || ''
        if (segs.length) {
            withSegments++
        }
        /**
         * 三个数要分开看，否则"段渲染能修好空气泡"会被夸大成"修好所有空气泡"：
         * 空 answer 的轮次里，只有**有段可渲染**的那部分能被段渲染救回来；
         * 另一部分本来就什么都没产出（段都没封），前端再怎么写也仍是空的。
         */
        if (!answer.trim()) {
            emptyAnswer++
            if (segs.length) {
                emptyAnswerButSegments++
                if (samples.length < 3) {
                    samples.push({
                        messageCode: view.messageCode,
                        段数: segs.length,
                        kinds: segs.map(s => `${s.kind}/${s.category}${s.ref ? `#${s.ref}` : ''}`),
                        段内字符合计: segs.reduce((a, s) => a + (s.metrics?.chars ?? s.text?.length ?? 0), 0),
                    })
                }
            } else {
                emptyAnswerUnrescuable++
            }
        }
        const sum = view?.process?.segmentSummary
        if (sum?.dropped?.count) {
            droppedSeen++
        }
        for (const s of segs) {
            kindCount[s.kind] = (kindCount[s.kind] || 0) + 1
        }
    }
    return {
        口径: label,
        样本条数: rows.length,
        视图含segments的条数: withSegments,
        '空answer条数(前端此刻渲染成空气泡)': emptyAnswer,
        '其中段渲染能救回的(empty answer 但有段)': emptyAnswerButSegments,
        '其中段渲染也救不回的(既无正文也无段)': emptyAnswerUnrescuable,
        有丢段记录的条数: droppedSeen,
        段kind分布: kindCount,
        样例: samples,
    }
}

const base = {status: {$ne: -1}}
/**
 * 统计口径修正（第一版在这里错过一次）：`message` 集合里**不只有助手应答行**。
 * u2u 推送与通知行的 `extInfo` 只有 `messageType/readStatus/readTime`，它们本来就没有 `answer`，
 * 把它们算进"空气泡"会把一个不存在的缺陷量成 18 条。判据用 `extInfo.messageType` 不存在，
 * 而不是猜某个 messageCode 前缀。
 */
const ASSISTANT = {'extInfo.messageType': {$exists: false}}
const results = []
/** 取值照 `MessageProgressEnum`：waiting/processing/finish/error/abort（不凭印象造枚举） */
results.push(await summarize({...base, progress: 'abort'}, 'progress=abort（被取消的轮次）'))
results.push(await summarize({...base, progress: 'finish'}, 'progress=finish（正常完成）'))
results.push(await summarize(base, '不限 progress 的最近轮次'))

/**
 * @description 把"空 answer"的轮次按**能救的方式**分类，而不是笼统计一条
 * @param {Object} view toMessageView 的结果
 * @param {Object} row 原始文档
 * @returns {String} 类别
 */
function classifyEmpty(view, row) {
    const segs = view?.process?.segments || []
    if (segs.length) {
        return '有段可回放'
    }
    const ei = row.extInfo || {}
    if (String(row.error || '').startsWith('abandoned:') || ei.lostChars !== undefined || ei.recoveredBy) {
        return '遗弃回填行(该显示丢了约N字)'
    }
    if (view?.process?.usage?.hasUsage) {
        return '模型跑过但没留下段(需查为何没封段)'
    }
    return '确实无内容(首token前取消)'
}

/**
 * @description 对空 answer 的轮次做分类计数
 * @param {String} progress 进度口径
 * @returns {Promise<Object>} 读数
 */
async function classifyEmpties(progress) {
    const rows = await Message.find({
        status: {$ne: -1}, progress, ...ASSISTANT,
        $or: [{answer: {$exists: false}}, {answer: ''}, {answer: null}],
    }).sort({insertTime: -1}).limit(LIMIT).lean().exec()
    const by = {}
    const loopExit = {}
    for (const r of rows) {
        const v = toMessageView(r)
        const c = classifyEmpty(v, r)
        by[c] = (by[c] || 0) + 1
        const le = String(v?.process?.loopExit ?? '(null)')
        loopExit[le] = (loopExit[le] || 0) + 1
    }
    return {progress, 空answer条数: rows.length, 按可救方式: by, loopExit分布: loopExit}
}

/** 每个 progress 口径返回一个对象，所以是"放进数组"而不是"展开"（上一版写成了 `...` 直接炸在这里） */
const empties = [await classifyEmpties('abort'), await classifyEmpties('finish'), await classifyEmpties('error')]

/**
 * @description 只读口径下的助手应答行数（用来证明"空 answer 占比"的分母）
 * @param {String} progress 进度
 * @returns {Promise<Number>} 条数
 */
async function assistantCount(progress) {
    return await Message.countDocuments({status: {$ne: -1}, progress, ...ASSISTANT})
}

/** 视图里到底有哪些 process 键（对着文档核一遍，别让我写的文档成为假承诺） */
const anyRow = await Message.find({...base, 'extInfo.segments.0': {$exists: true}}).sort({insertTime: -1}).limit(1).lean().exec()
const viewKeys = anyRow?.length ? Object.keys(toMessageView(anyRow[0]).process || {}) : []
const segShape = anyRow?.length ? (toMessageView(anyRow[0]).process.segments || [])[0] || null : null

/**
 * 逐行样本（每类各取几条）：光有分类计数不够，得看得见**支撑分类的字段长什么样**——
 * `lostChars`/`recoveredBy` 证明"遗弃回填行"该显示丢了约 N 字，
 * `usage.hasUsage` 与 `answerList轮数` 证明"模型跑过"却没留下正文。
 * 只打长度与字段名，不打正文。
 */
const samplesByClass = {}
for (const p of ['abort', 'error', 'finish']) {
    const rows = await Message.find({
        ...base, progress: p, ...ASSISTANT,
        $or: [{answer: {$exists: false}}, {answer: ''}, {answer: null}],
    }).sort({insertTime: -1}).limit(20).lean().exec()
    for (const r of rows) {
        const v = toMessageView(r)
        const cls = classifyEmpty(v, r)
        samplesByClass[cls] = samplesByClass[cls] || []
        if (samplesByClass[cls].length >= 2) {
            continue
        }
        const ei = r.extInfo || {}
        samplesByClass[cls].push({
            progress: p,
            messageCode: r.messageCode,
            库answer长度: (r.answer || '').length,
            loopExit: v?.process?.loopExit ?? null,
            段数: (v?.process?.segments || []).length,
            hasUsage: v?.process?.usage?.hasUsage ?? null,
            completionTokens: v?.process?.usage?.completionTokens ?? null,
            answerList轮数: Array.isArray(ei.answerList) ? ei.answerList.length : null,
            lostChars: ei.lostChars ?? null,
            interruptedBy: ei.interruptedBy ?? null,
            writtenBy: ei.writtenBy ?? null,
            error字段: (r.error || '').slice(0, 60) || null,
        })
    }
}

log('历史视图的 segments 形状', {
    样本上限: LIMIT,
    process键全集: viewKeys,
    一条段的字段: segShape ? Object.keys(segShape) : '(无)',
    一条段的样例: segShape ? {...segShape, text: `${String(segShape.text || '').length}字（正文已省略）`} : null,
    统计: results,
    /** 分母：同口径下各 progress 一共多少助手行，否则"15 条空"没有可比性 */
    助手行分母: {
        abort: await assistantCount('abort'),
        finish: await assistantCount('finish'),
        error: await assistantCount('error'),
        processing: await assistantCount('processing'),
    },
    空answer分类计数: empties,
    各类样本: samplesByClass,
})
process.exit(0)
