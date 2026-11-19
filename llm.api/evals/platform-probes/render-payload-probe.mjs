/**
 * @fileOverview 历史视图的渲染载荷与裁剪实况（只读）
 * @module evals/platform-probes/render-payload-probe
 * @description
 * 为"段/工具数据给前端渲染是否可行、该不该改存全文"取前置读数。三个问题各自独立，混起来必然得错结论：
 *
 * 1. **前端一行历史到底多大**：每行经 `toMessageView` 后的字符数/UTF-8 字节数分布
 *    （一页几十行的话，网络与渲染成本能不能接受，只能由分布回答）。
 * 2. **现在的裁剪抹掉了多少**，三处互不相干：
 *    - 段正文：`sealSegment` 按 `segmentTextChars` 截，`truncated` 声明、`metrics.chars` 留真值；
 *    - 整段丢弃：`fitSegments` 超段数上限丢最早段，只进 `segmentSummary.dropped`（视图给了但四端都没渲染）；
 *    - 工具结果：`clipTraceResult` 定死 4000 字符（非配置项），尾部 `...[truncated]`。
 *    `BODY_IN_ANSWER`（answer/finalize/cancelled）的段 **text 故意为空**、`ref:'answer'`：
 *    那是指针不是截断，计入"被抹掉的量"会把设计说成缺陷，所以分开统计。
 * 3. **不裁的话多大**：段原文量与 `toolOverflows.chars` 分布，用来判断存全文会不会撞
 *    MongoDB 单文档 16MB 上限——这不是磁盘配额，是硬上限。同一个文档里已经住着
 *    **顶层 `messages`（发给模型的完整提示词，schema 里不在 extInfo）**、
 *    `extInfo.toolOverflows`（被裁工具结果的全文，留档上限 200k 字符/条）、`extInfo.segments`；
 *    判断余量必须把 `messages` 算进去，所以探针把它单独量出来。
 *    （上一版探针读 `extInfo.messages` 得到样本 0 —— 字段位置靠猜就是这种结果。）
 * 4. **入参有没有存**：现场读 `process.toolCalls` 的键集，不引用注释。
 *
 * 只读：不写任何集合；不打印正文与问题原文，只给长度、形状、比率。
 *
 * 用法（在 pod 里跑；**默认值即文档引用的那次口径**，重跑应当可比）：
 *   kubectl -n xxzx cp src/evals/platform-probes/render-payload-probe.mjs <pod>:/app/evals/platform-probes/
 *   kubectl -n xxzx exec <pod> -- sh -c "cd /app && node evals/platform-probes/render-payload-probe.mjs --out=/tmp/rp.jsonl"
 *   （`abort` 口径全量目前只有 55 条，传再大的数也不会更多；1,555 行的取样在单次 `exec` 内跑完，
 *   我没有单独计时——200 行那一批实测约 3 秒，行数不是瓶颈的证据只有这一条，别当成"任意大小都秒回"）
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
const OUT = val('out', '')
const LINES = []

/**
 * @description 先落文件再打印（中文键名不经 shell 重定向，免得读数被编码弄坏）
 * @param {String} note 事件
 * @param {Object} obj 字段
 * @returns {void}
 */
function log(note, obj = {}) {
    const line = JSON.stringify({probe: 'render-payload', note, ...obj})
    LINES.push(line)
    console.log(line)
    if (OUT) {
        fs.writeFileSync(OUT, LINES.join('\n') + '\n')
    }
}

/** 与 clipTraceResult 的标注一致，用来识别"这条 result 被裁过" */
const CLIP_MARK = '...[truncated]'

await import('../../init.js')
const {Message} = await import('../../daos/core/schema/index.js')
const {toMessageView} = await import('../../services/core/message.js')

/**
 * @description 分位数
 * @param {Number[]} xs 数值
 * @param {Number} q 0~1
 * @returns {Number} 分位值
 */
function pct(xs, q) {
    if (!xs.length) {
        return 0
    }
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}

/**
 * @description 一组数的摘要
 * @param {Number[]} xs 数值
 * @returns {Object} 摘要
 */
function d(xs) {
    if (!xs.length) {
        return {样本: 0}
    }
    const sum = xs.reduce((a, b) => a + b, 0)
    return {
        样本: xs.length,
        均值: Math.round(sum / xs.length),
        p50: pct(xs, 0.5),
        p90: pct(xs, 0.9),
        p99: pct(xs, 0.99),
        最大: Math.max(...xs),
        合计: sum,
    }
}

/**
 * @description 扫一批行
 * @param {Object} q 查询条件
 * @param {Number} n 取样条数
 * @param {String} label 口径名
 * @returns {Promise<Object>} 读数
 */
async function scan(q, n, label) {
    /** 与 segments-view-probe 同口径：排除 u2u/通知行，否则比率被没有 extInfo 的行稀释 */
    /** 分批前先报一声：init.js 之后还挂着 redis/kafka 句柄，卡在哪一段要能看出来 */
    log('取样开始', {口径: label, 计划: n})
    const rows = await Message.find({...q, 'extInfo.messageType': {$exists: false}})
        .sort({insertTime: -1}).limit(n).lean().exec()
    log('取样完成', {口径: label, 条数: rows.length})
    const viewChars = [], viewBytes = [], docBytes = [], extMsgBytes = []
    const segPerRow = [], segStoredChars = [], segRawChars = [], segOmitChars = []
    const tcPerRow = [], tcResultChars = [], ovChars = []
    const toolNames = {}
    const tcKeys = new Set()
    let dropped = 0, droppedRows = 0, droppedChars = 0
    let rowsSeg = 0, rowsTruncSeg = 0, segTrunc = 0, segPointer = 0, segAll = 0
    let tcAll = 0, tcClipped = 0, tcEmpty = 0, tcArgs = 0
    const acChars = []
    let acAll = 0, acTruncated = 0, acZero = 0
    let ovAll = 0, ovNotStored = 0, ovStoredChars = 0, ovMaxSingle = 0
    let viewOver1MB = 0, docOver5MB = 0
    /**
     * 视图 `process` 的键集（现网读数）。文档里那份 `DEV_MEASURED_PROCESS_KEYS` 清单此前只有本地断言，
     * 没有"线上到底给了什么键"的证据；键集种类应当只有 1 种，多于 1 种就是形状漂移。
     */
    const processKeySets = new Set()
    const samples = []
    for (const row of rows) {
        const view = toMessageView(row)
        processKeySets.add(Object.keys(view?.process || {}).join(','))
        const vj = JSON.stringify(view)
        viewChars.push(vj.length)
        viewBytes.push(Buffer.byteLength(vj, 'utf8'))
        const dbBytes = Buffer.byteLength(JSON.stringify(row), 'utf8')
        docBytes.push(dbBytes)
        if (dbBytes > 5 * 1024 * 1024) {
            docOver5MB++
        }
        const ext = row.extInfo || {}
        /**
         * 发给模型的完整提示词在**顶层 `messages`**（见 messageSchema），不在 extInfo 里。
         * 上一版探针读的是 `extInfo.messages`，样本数因此为 0——"字段在哪"这件事也不能靠印象。
         */
        const promptMsgs = ext.messages || row.messages
        if (promptMsgs) {
            extMsgBytes.push(Buffer.byteLength(JSON.stringify(promptMsgs), 'utf8'))
        }
        if (Buffer.byteLength(vj, 'utf8') > 1024 * 1024) {
            viewOver1MB++
        }
        const segs = view?.process?.segments || []
        if (segs.length) {
            rowsSeg++
            segPerRow.push(segs.length)
        }
        let rowOmit = 0, rowStored = 0, rowRaw = 0
        for (const s of segs) {
            segAll++
            if (s.ref === 'answer') {
                segPointer++
                continue
            }
            const stored = typeof s.text === 'string' ? s.text.length : 0
            const raw = Number(s.metrics?.chars) || 0
            segStoredChars.push(stored)
            segRawChars.push(raw)
            const omit = Math.max(0, raw - stored)
            segOmitChars.push(omit)
            rowOmit += omit
            rowStored += stored
            rowRaw += raw
            if (s.truncated) {
                segTrunc++
            }
            for (const t of s.tools || []) {
                toolNames[t?.name || '?'] = (toolNames[t?.name || '?'] || 0) + 1
            }
        }
        if (segs.some(s => s.truncated && s.ref !== 'answer')) {
            rowsTruncSeg++
        }
        if (rowOmit > 0 && samples.length < 4) {
            samples.push({段数: segs.length, 留存: rowStored, 原文: rowRaw, 视图字符: vj.length})
        }
        const sum = view?.process?.segmentSummary
        if (sum?.dropped?.count) {
            droppedRows++
            dropped += sum.dropped.count
            droppedChars += sum.dropped.chars || 0
        }
        const tcs = view?.process?.toolCalls || []
        if (tcs.length) {
            tcPerRow.push(tcs.length)
        }
        for (const t of tcs) {
            tcAll++
            for (const k of Object.keys(t)) {
                tcKeys.add(k)
            }
            if ('arguments' in t || 'args' in t) {
                tcArgs++
            }
            /**
             * 入参这一族键是 H1 才加的，所以**同一个视图里会同时出现两种形状**：
             * 新行带 args/argsChars/argsTruncated，存量行不带。这里的计数就是给"前端必须区分
             * '确实传了空参数'与'当时没记录'"提供现网比例，而不是等有人踩到再查。
             */
            if ('args' in t) {
                acAll++
                const ac = Number(t.argsChars) || 0
                acChars.push(ac)
                if (ac === 0) {
                    acZero++
                }
                if (t.argsTruncated) {
                    acTruncated++
                }
            }
            const rc = typeof t.result === 'string' ? t.result.length : 0
            tcResultChars.push(rc)
            if (rc && t.result.endsWith(CLIP_MARK)) {
                tcClipped++
            }
            if (!rc) {
                tcEmpty++
            }
        }
        for (const o of ext.toolOverflows || []) {
            ovAll++
            ovChars.push(Number(o.chars) || 0)
            const sc = typeof o.content === 'string' ? o.content.length : 0
            if (sc > ovMaxSingle) {
                ovMaxSingle = sc
            }
            ovStoredChars += sc
            if (o.stored === false) {
                ovNotStored++
            }
        }
    }
    return {
        口径: label,
        取样: rows.length,
        每行视图: {字符: d(viewChars), 字节: d(viewBytes)},
        每行文档字节: {...d(docBytes), '超5MB的行数': docOver5MB},
        每行提示词messages字节: d(extMsgBytes),
        视图超1MB的行数: viewOver1MB,
        段: {
            有段的行: rowsSeg,
            段总数: segAll,
            指针段: segPointer,
            截断段: segTrunc,
            有截断段的行: rowsTruncSeg,
            每行段数: d(segPerRow),
            留存字符: d(segStoredChars),
            原文字符: d(segRawChars),
            被省略字符: d(segOmitChars),
        },
        丢段: {行数: droppedRows, 段数: dropped, 字符: droppedChars},
        工具调用: {
            总数: tcAll,
            每行次数: d(tcPerRow),
            键集: [...tcKeys],
            含入参的条目: tcArgs,
            入参: {带args键的条数: acAll, argsChars分布: d(acChars), 入参长度为0: acZero, 入参被裁: acTruncated},
            结果被裁: tcClipped,
            结果空: tcEmpty,
            结果字符: d(tcResultChars),
        },
        溢出留档: {条数: ovAll, 原文字符: d(ovChars), 未留档: ovNotStored, 实存字符: ovStoredChars, 最大单条字符: ovMaxSingle},
        工具名分布: toolNames,
        视图process键集种类: [...processKeySets],
        样例: samples,
    }
}

const base = {status: {$ne: -1}}
const R = []
/** 默认口径 = 文档里那批读数（800 finish + 55 abort 全量 + 700 混合），重跑才可比 */
R.push(await scan({...base, progress: 'finish'}, Number(val('finish', 800)), 'progress=finish'))
R.push(await scan({...base, progress: 'abort'}, Number(val('abort', 300)), 'progress=abort'))
R.push(await scan(base, Number(val('all', 700)), '不限 progress'))
log('完成', {结果: R})
/**
 * `init.js` 会打开 redis/kafka 等句柄，探针跑完不会自然退出（前一次就是这么把 exec 挂到超时的）。
 * 读数已经落到 OUT 文件（writeFileSync 是同步的），这里显式退出。
 */
process.exit(0)
