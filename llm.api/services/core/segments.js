/**
 * @fileOverview 一轮执行的过程分段（segments）
 * @module services/core/segments
 * @description
 * PR-B 的第一块：**先把过程留住，不动 SSE 协议**。
 *
 * 为什么要留住：dev 实测 `extInfo.answerList` 的段数分布是
 * `0 段 344 / 1 段 147 / 2 段 65 / 3 段 3 / 4 段 6 / 5 段 6 / 6 段 3`
 * ⇒ **230/574（40%）的轮次存在被 `reset` 抹掉的中间内容**。
 * 现在这些内容只在客户端流里出现过一次，落库只剩"最后一句"或干脆空串——
 * 回放看不出模型这一轮到底查了什么、说过什么，评测也没有轨迹可算。
 *
 * 三条设计约束：
 * 1. **`kind`/`category`/`title`/`metrics` 全部由服务端给出**（前端零猜测）：
 *    四端共用同一个 x-sdk，若让前端自己从事件序列推断"这是什么阶段"，就会有第四份实现；
 * 2. **正文按预算截断，但计数用原文真实量**：`metrics.chars` 永远是未截断的字符数，
 *    超没超由 `truncated` 声明——体积可控，而"这一段有多长"这个事实不被截断污染；
 * 3. **超限丢最早段并留下丢弃摘要**（`dropped`）：宁缺毋滥，但必须让人看出"这里缺过东西"，
 *    静默截断比截断本身更糟。
 *
 * 本模块零依赖、可离线穷举（与 `messageScope.js`/`contactScope.js` 同口径）。
 */

/** 段类型：模型这一段时间在干什么 */
export const SEGMENT_KINDS = {
    /** 一次工具往返：半句正文 + 若干工具调用 */
    TOOL_ROUND: 'tool-round',
    /** 动态技能命中后重新请求：正文被丢弃重来 */
    SKILL_RELOAD: 'skill-reload',
    /** 上限打满后的无工具收尾调用 */
    FINALIZE: 'finalize',
    /** 最终回答（正文不重复存，只给计数与指针） */
    ANSWER: 'answer',
    /**
     * §8.2/D3 的"半句"：生成被打断时已经产出的那段文字。
     * 正文同样已在 `message.answer` 里（见 `BODY_IN_ANSWER`），段里只给计数与指针；
     * 它让"这一轮被打断在何处、当时已说多少字"成为可回放的事实，而不是只剩一条 progress 让人猜。
     */
    CANCELLED: 'cancelled',
}

/** 前端分组用的大类：与 kind 分开，是为了让 kind 可以细化而不影响渲染 */
export const SEGMENT_CATEGORIES = {
    TOOLS: 'tools',
    SKILL: 'skill',
    TEXT: 'text',
}

/** 单段正文的默认字符预算（与 trace 的 clipTraceResult 不同：这里是给人回看的完整过程） */
export const DEFAULT_SEGMENT_TEXT_CHARS = 2000

/** 最多留几段：dev 观测上限 6 段，给 8 的余量 */
export const DEFAULT_MAX_SEGMENTS = 8

/**
 * @description 生成人读标题（服务端给，前端不推断）
 * @param {String} kind SEGMENT_KINDS 之一
 * @param {Object[]} [tools] 该段的工具调用（`{name}` 即可）
 * @param {String} [extra] 附加信息（如技能名）
 * @returns {String} 标题
 */
export function segmentTitle(kind, tools = [], extra = '') {
    const names = (tools || []).map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
    switch (kind) {
        case SEGMENT_KINDS.TOOL_ROUND:
            return names.length ? `调用 ${names.length} 个工具：${names.join('、')}` : '调用工具'
        case SEGMENT_KINDS.SKILL_RELOAD:
            return extra ? `加载技能「${extra}」后重新回答` : '加载技能后重新回答'
        case SEGMENT_KINDS.FINALIZE:
            return '工具次数用尽，补一次无工具收尾'
        case SEGMENT_KINDS.ANSWER:
            return '最终回答'
        case SEGMENT_KINDS.CANCELLED:
            return '生成被打断，已产出的部分留在答案里'
        default:
            return extra || '过程片段'
    }
}

/**
 * @description 按 kind 给出渲染大类
 * @param {String} kind SEGMENT_KINDS 之一
 * @returns {'tools'|'skill'|'text'} category
 */
export function segmentCategory(kind) {
    if (kind === SEGMENT_KINDS.TOOL_ROUND) {
        return SEGMENT_CATEGORIES.TOOLS
    }
    if (kind === SEGMENT_KINDS.SKILL_RELOAD) {
        return SEGMENT_CATEGORIES.SKILL
    }
    return SEGMENT_CATEGORIES.TEXT
}

/**
 * 正文以 `message.answer` 为准的 kind：这些段的全文已经在 answer 里，
 * 段里再存一份就是同一篇文章占两处（实测一轮 finalize 610 字，重复一份就是 610 字白占）。
 */
export const BODY_IN_ANSWER = [SEGMENT_KINDS.ANSWER, SEGMENT_KINDS.FINALIZE, SEGMENT_KINDS.CANCELLED]

/**
 * @description 判断"这次落库要不要补一段 `cancelled`"（纯函数，判决与写分离）
 * @param {Object} p 现场
 * @param {String} p.progress 本次落库的 progress
 * @param {String} p.answer 即将写进 `message.answer` 的正文
 * @param {Object[]} [p.sealed] 已经封存的段（按 seq 升序）
 * @returns {Boolean} 是否该补
 *
 * 四条拒绝规则都有对应的真实形状，不是防御性凑数：
 * - 非 abort ⇒ 没有"被打断"这件事；
 * - 正文空 ⇒ 没有可标的事实，硬封一段 0 字只会让时间线多一张空卡；
 * - 最后一段就是同样字数 ⇒ 已经标过了（`persistTurn` 有幂等位，但幂等位挡不住
 *   同一次里既走早停封存、又走这里的补封）；
 * - 早停路径已经把同样的正文封成 `answer`/`finalize` ⇒ 再补 `cancelled` 就是**同一句话记两次**，
 *   而那正是 PR-B 立项时要消灭的东西。
 */
export function needsCancelledSegment({progress, answer = '', sealed = []} = {}) {
    if (progress !== 'abort') {
        return false
    }
    if (!answer || !answer.length) {
        return false
    }
    const last = sealed[sealed.length - 1]
    if (!last) {
        return true
    }
    const sameBody = last.metrics?.chars === answer.length
    if (sameBody && (last.kind === SEGMENT_KINDS.CANCELLED
        || last.kind === SEGMENT_KINDS.ANSWER
        || last.kind === SEGMENT_KINDS.FINALIZE)) {
        return false
    }
    return true
}



/**
 * @description 把原始正文与工具调用折成一段可入库的 segment（纯函数）
 * @param {Object} input 现场
 * @param {Number} input.seq 段序号（从 1 开始）
 * @param {String} input.kind SEGMENT_KINDS 之一
 * @param {String} [input.text] 该段正文
 * @param {Array<String|{name:*, arguments?:*}>} [input.tools] 工具调用，允许只给名字
 * @param {Number} [input.startedAt] 段起始毫秒时间戳
 * @param {Number} [input.now] 段结束毫秒时间戳（注入以便测试确定性）
 * @param {Number} [input.textChars] 单段正文预算
 * @param {String} [input.title] 覆盖自动标题
 * @param {String} [input.extra] 附加信息（技能名等）
 * @returns {{seq: Number, kind: String, category: String, title: String, text: String, ref: String|null, tools: Object[], metrics: {chars: Number, toolCount: Number, ms: Number}, truncated: Boolean}} 折好的段
 */
export function sealSegment({
    seq = 1,
    kind = SEGMENT_KINDS.TOOL_ROUND,
    text = '',
    tools = [],
    startedAt = 0,
    now = Date.now(),
    textChars = DEFAULT_SEGMENT_TEXT_CHARS,
    title = '',
    extra = '',
} = {}) {
    /** 非字符串（对象/数组）折成 JSON：过程里偶尔会塞结构化片段，`String(obj)` 会变成 [object Object] 那种没用的东西 */
    const raw = typeof text === 'string' ? text : (text === null || text === undefined ? '' : JSON.stringify(text))
    const limit = Number(textChars) > 0 ? Number(textChars) : DEFAULT_SEGMENT_TEXT_CHARS
    const names = (tools || [])
        .map(t => (typeof t === 'string' ? t : t?.name))
        .filter(Boolean)
    /**
     * `answer` 与 `finalize` 的正文已经在 `message.answer` 里（`finalize` 的输出就是最终答案），
     * 段里只留计数与指针：省体积，也避免回放时"段"和"答案"各说各话。
     * 真正需要留住的是**被 reset 抹掉的那些段**。
     */
    const inAnswer = BODY_IN_ANSWER.includes(kind)

    return {
        seq,
        kind,
        category: segmentCategory(kind),
        title: title || segmentTitle(kind, names, extra),
        text: inAnswer ? '' : (raw.length > limit ? raw.slice(0, limit) : raw),
        /** 正文在别处时，告诉读的人去哪儿找 */
        ref: inAnswer ? 'answer' : null,
        tools: names.map(name => ({name})),
        metrics: {
            /** 原文真实字符数，不受截断影响 */
            chars: raw.length,
            toolCount: names.length,
            ms: startedAt ? Math.max(0, now - startedAt) : 0,
        },
        truncated: !inAnswer && raw.length > limit,
    }
}

/**
 * @description 段数超限时保留最近的段，并生成"丢了多少"的摘要（纯函数）
 * @param {Object[]} segments 已封存的段（按 seq 升序）
 * @param {Number} [maxSegments] 段数上限
 * @returns {{segments: Object[], dropped: {count: Number, chars: Number}}} 收敛结果
 */
export function fitSegments(segments = [], maxSegments = DEFAULT_MAX_SEGMENTS) {
    const cap = Number(maxSegments) > 0 ? Number(maxSegments) : DEFAULT_MAX_SEGMENTS
    const list = segments.filter(Boolean)
    if (list.length <= cap) {
        return {segments: list, dropped: {count: 0, chars: 0}}
    }
    const cut = list.slice(0, list.length - cap)
    const dropped = cut.reduce((acc, s) => ({count: acc.count + 1, chars: acc.chars + (s?.metrics?.chars || 0)}), {count: 0, chars: 0})
    return {segments: list.slice(list.length - cap), dropped}
}

/**
 * @description 总量封顶：逐段收缩正文，直到累计字符数进入预算（纯函数，不改入参）
 * @param {Object[]} segments 段列表
 * @param {Number} [totalChars] 全部段正文的字符预算
 * @returns {Object[]} 收缩后的新段列表
 */
export function fitSegmentsVolume(segments = [], totalChars = 12000) {
    const budget = Number(totalChars) > 0 ? Number(totalChars) : 12000
    const list = (segments || []).filter(Boolean)
    const used = () => list.reduce((n, s) => n + (s.text ? s.text.length : 0), 0)
    if (used() <= budget) {
        return list.map(s => ({...s}))
    }

    /**
     * 均摊到每段：给每段同样的字符额度，比"丢整段"更公平，
     * 也保证 metrics.chars 仍是原文真实长度（截断只影响 text）。
     * 这里**不设最小保留字数**：一旦设了，段数一多就会突破总预算，"封顶"就成了假话。
     */
    const per = Math.max(1, Math.floor(budget / list.length))
    return list.map(s => {
        /** 只收缩真的存了正文的段：`answer`/`finalize` 的 text 是有意为空的，把它们标成 truncated 就是假警报 */
        const body = typeof s.text === 'string' ? s.text : ''
        if (!body.length) {
            return {...s}
        }
        return {
            ...s,
            text: body.length > per ? body.slice(0, per) : body,
            truncated: s.truncated || body.length > per,
        }
    })
}

/**
 * @description 建一个过程分段账本（唯一的可变结构，且只在内存里）
 * @param {Object} [budget] 体积预算
 * @param {Number} [budget.textChars] 单段正文预算
 * @param {Number} [budget.maxSegments] 段数上限
 * @param {Number} [budget.totalChars] 段正文总预算
 * @returns {{seal: Function, list: Function, summary: Function, has: Function, count: Function}} 账本接口
 */
export function createSegmentLedger({
    textChars = DEFAULT_SEGMENT_TEXT_CHARS,
    maxSegments = DEFAULT_MAX_SEGMENTS,
    totalChars = 12000,
    events = false,
    onEvent = () => {},
} = {}) {
    const segs = []
    let dropped = {count: 0, chars: 0}
    /** 当前开着的段（仅 events 模式用）。seq 是与 segment_end 的唯一关联键 */
    let opened = null

    /**
     * @description 开一段：只在协议 3 下产生事件；同一段未封存前重复 open 会被忽略
     * @param {Object} [meta] 段的开场信息
     * @returns {Object|null} 事件载荷；events 关闭时返回 null
     */
    const open = (meta = {}) => {
        if (!events) {
            return null
        }
        if (opened) {
            return segmentStartEvent(opened)
        }
        opened = {
            seq: segs.length + dropped.count + 1,
            kind: meta.kind || SEGMENT_KINDS.TOOL_ROUND,
            title: meta.title || segmentTitle(meta.kind || SEGMENT_KINDS.TOOL_ROUND, meta.tools || [], meta.extra || ''),
            startedAt: meta.startedAt || Date.now(),
        }
        const payload = segmentStartEvent(opened)
        onEvent('segment_start', payload)
        return payload
    }

    /**
     * @description 封一段（正文与工具快照就地折好）
     * @param {Object} input 见 `sealSegment`
     * @returns {Object} 本次封存的段
     */
    const seal = (input = {}) => {
        const seg = sealSegment({
            seq: segs.length + dropped.count + 1,
            textChars,
            ...input,
        })
        /** 不变量：segment_end 绝不单独出现；漏 open 时补发 start */
        if (events) {
            if (!opened || opened.seq !== seg.seq) {
                onEvent('segment_start', segmentStartEvent({seq: seg.seq, kind: seg.kind, title: seg.title}))
            }
            onEvent('segment_end', segmentEndEvent(seg))
            opened = null
        }
        segs.push(seg)
        const fit = fitSegments(segs, maxSegments)
        segs.length = 0
        segs.push(...fit.segments)
        dropped = {count: dropped.count + fit.dropped.count, chars: dropped.chars + fit.dropped.chars}
        return seg
    }

    /**
     * @description 取可入库的段列表（已按总预算收缩）
     * @returns {Object[]} 段列表
     */
    const list = () => fitSegmentsVolume(segs, totalChars)

    /**
     * @description 账本摘要：丢段信息与留存下来的**过程**字数
     *
     * **口径只有一件事：留存下来的过程正文总量（按原文长度计，含被丢掉的那些段）**。
     * 带 `ref:'answer'` 的段（`answer`/`finalize`）不参与——它们的全文就是 `message.answer`，
     * 已经由那个字段计过一次；再计一次会让这个数既是"过程量"又是"总量"，谁也说不清它是什么。
     * 尤其注意：兜底路径上"部分正文 + 原因"会同时出现在过程段和 `answer` 里，
     * 按旧口径（把所有段相加 + 只去重一次）算就是重复计数。
     * @returns {{count: Number, processChars: Number, dropped: {count: Number, chars: Number}}} 摘要
     */
    const summary = () => {
        const kept = list()
        const processChars = kept
            .filter(s => s.ref !== 'answer')
            .reduce((n, s) => n + (s.metrics?.chars || 0), 0)
        return {
            count: kept.length,
            processChars: processChars + dropped.chars,
            dropped,
        }
    }

    /**
     * @description 某个 kind 是否已经封过（用于避免"同一篇正文封两段"）
     * @param {String} kind SEGMENT_KINDS 之一
     * @returns {Boolean} 是否存在
     */
    const has = (kind) => segs.some(s => s.kind === kind)

    return {
        open,
        seal,
        list,
        summary,
        has,
        count: () => segs.length,
    }
}
/**
 * `segment_start` 的载荷（协议 3）。
 * 只带"客户端要开一张什么样的卡"所需的最小字段——**全部由服务端给**（D63 ①）：
 * 四端共用同一个 x-sdk，让前端从事件序列反推"这是什么阶段"就会长出第四份实现。
 * @param {Object} p 参数
 * @param {Number} p.seq 段序号（与对应 `segment_end` 相同，是唯一的关联键）
 * @param {String} p.kind SEGMENT_KINDS 之一
 * @param {String} [p.title] 人读标题
 * @param {String} [p.category] 覆盖分组
 * @returns {Object} 事件载荷
 */
export function segmentStartEvent({seq = 1, kind = SEGMENT_KINDS.TOOL_ROUND, title = '', category = ''} = {}) {
    return {
        seq,
        kind,
        category: category || segmentCategory(kind),
        title: title || segmentTitle(kind),
    }
}

/**
 * `segment_end` 的载荷（协议 3）：把已封存的段的**计数与形态**告诉客户端，正文不下发。
 *
 * 为什么不下发正文：`extInfo.segments` 落库时才有截断与总预算收敛（`fitSegmentsVolume`），
 * 实时下发若带正文，就会出现"流里看到的"与"库里回放的"两套字数；
 * 而段的正文本来就该由 `delta` 流呈现，这里只负责**边界与事实**（多长、截断没、几个工具、耗时）。
 * @param {Object} seg `sealSegment` 的产物
 * @returns {Object} 事件载荷
 */
export function segmentEndEvent(seg = {}) {
    return {
        seq: seg.seq,
        kind: seg.kind,
        category: seg.category || segmentCategory(seg.kind),
        title: seg.title || segmentTitle(seg.kind),
        metrics: seg.metrics || {chars: 0, toolCount: 0, ms: 0},
        truncated: Boolean(seg.truncated),
        ref: seg.ref ?? null,
    }
}

