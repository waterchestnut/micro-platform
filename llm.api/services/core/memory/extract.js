/**
 * @fileOverview 记忆抽取的输入构造与输出校验（纯函数）
 * @module services/core/memory/extract
 * @description 与真正的 LLM 调用分离，便于在无网络无数据库的情况下回归校验口径。
 * 抽取只允许引用给定的事件标识，杜绝凭空编造证据。
 */

export const CANDIDATE_KINDS = ['fact', 'preference', 'decision', 'profile']

/** 候选正文的长度区间：下限滤掉"嗯/好的"这类无信息量片段，上限对齐索引侧 chunk 约束 */
export const CANDIDATE_MIN_CHARS = 10
export const CANDIDATE_MAX_CHARS = 500

/**
 * @description 构造抽取提示词
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object[]} params.events 待抽取的事件（含 eventCode/role/content）
 * @param {String} [params.channel] 频道，用于给模型一点领域背景
 * @returns {Object[]} system/user 两条消息
 */
export function buildExtractMessages({events = [], channel = ''} = {}) {
    const lines = events.map(e => `[${e.eventCode}] ${e.role}: ${String(e.content || '').slice(0, 1500)}`)
    return [
        {
            role: 'system',
            content: [
                '你是记忆抽取器。从给定的对话片段中提炼值得长期保留的事实。',
                '规则：',
                '1. 只输出 JSON 数组，不要任何解释文字、不要 markdown 代码块。',
                `2. 每项形如 {"content":"...","kind":"fact|preference|decision|profile","topic":"主题词","confidence":0.0-1.0,"evidence":["事件标识"],"entities":[{"entityCode":"...","name":"..."}]}`,
                '3. evidence 只能使用上面方括号中给出的事件标识，不得编造；没有证据支撑的一律不输出。',
                `4. content 为独立可读的陈述句，长度 ${CANDIDATE_MIN_CHARS}-${CANDIDATE_MAX_CHARS} 字，不要复述完整对话。`,
                '5. 不抽取：闲聊客套、一次性任务细节、模型自身的不确定表述、涉及密钥或证件号等敏感原文的内容。',
                '6. 没有值得长期保留的内容时，输出 []。',
                channel ? `（当前频道：${channel}）` : '',
            ].filter(Boolean).join('\n'),
        },
        {
            role: 'user',
            content: lines.join('\n'),
        },
    ]
}

/**
 * @description 从模型回复中取出 JSON 数组，容忍被代码块包裹的情况
 * @author xianyang
 * @param {String} text 模型输出
 * @returns {Object[]|null} 解析结果，无法解析返回 null
 */
export function parseExtractJson(text) {
    if (typeof text !== 'string' || !text.trim()) {
        return null
    }
    const cleaned = text
        .replace(/^\s*```(?:json)?/i, '')
        .replace(/```\s*$/i, '')
        .trim()
    const start = cleaned.indexOf('[')
    const end = cleaned.lastIndexOf(']')
    if (start < 0 || end <= start) {
        return null
    }
    try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1))
        return Array.isArray(parsed) ? parsed : null
    } catch {
        return null
    }
}

/**
 * @description 校验并归一化一条抽取结果
 * @author xianyang
 * @param {Object} raw 模型给出的候选
 * @param {Object} ctx 校验上下文
 * @param {String[]} ctx.allowedEventCodes 本次投喂的事件标识白名单
 * @returns {Object|null} 合法则返回归一化候选，否则 null
 */
export function normalizeCandidate(raw, {allowedEventCodes = []} = {}) {
    if (!raw || typeof raw !== 'object') {
        return null
    }
    const content = typeof raw.content === 'string' ? raw.content.trim() : ''
    if (content.length < CANDIDATE_MIN_CHARS || content.length > CANDIDATE_MAX_CHARS) {
        return null
    }
    const kind = CANDIDATE_KINDS.includes(raw.kind) ? raw.kind : 'fact'
    let confidence = Number(raw.confidence)
    if (!Number.isFinite(confidence)) {
        confidence = 0.5
    }
    confidence = Math.min(1, Math.max(0, confidence))

    /** 证据必须全部落在白名单内，出现任何编造的标识即整体作废；重复标识先去重再比对 */
    const claimed = Array.isArray(raw.evidence) ? raw.evidence.filter(_ => typeof _ === 'string') : []
    const uniqueClaimed = [...new Set(claimed.map(_ => _.trim()).filter(Boolean))]
    const evidence = uniqueClaimed.filter(_ => allowedEventCodes.includes(_))
    if (!evidence.length || evidence.length !== uniqueClaimed.length) {
        return null
    }

    const entities = (Array.isArray(raw.entities) ? raw.entities : [])
        .filter(e => e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim())
        .map(e => ({
            entityCode: typeof e.entityCode === 'string' && e.entityCode.trim() ? e.entityCode.trim() : null,
            name: e.name.trim(),
        }))

    return {
        content,
        kind,
        topic: typeof raw.topic === 'string' && raw.topic.trim() ? raw.topic.trim().slice(0, 64) : 'general',
        confidence,
        evidence: [...new Set(evidence)].map(eventCode => ({eventCode, quote: null})),
        eventCodes: [...new Set(evidence)],
        entities,
    }
}

/**
 * @description 批量校验抽取结果
 * @author xianyang
 * @param {String} text 模型输出
 * @param {Object} ctx 校验上下文
 * @returns {{candidates: Object[], rejected: Number}} 合法候选与被丢弃条数
 */
export function parseExtractResult(text, ctx = {}) {
    const parsed = parseExtractJson(text)
    if (!parsed) {
        return {candidates: [], rejected: 0, unparsable: true}
    }
    const candidates = []
    let rejected = 0
    for (const item of parsed) {
        const ok = normalizeCandidate(item, ctx)
        if (ok) {
            candidates.push(ok)
        } else {
            rejected++
        }
    }
    return {candidates, rejected, unparsable: false}
}
