/**
 * @fileOverview 记忆策略判定（纯函数，不触达任何外部依赖）
 * @module services/core/memory/policy
 * @description 刻意与采集/命名空间分离：这里只回答"该不该记、该不该用"，
 * 便于在无数据库的情况下做回归验证。
 */

/** 批量/智能体类会话默认不写入用户命名空间，避免爬虫与推荐结果污染个人记忆 */
export const EXCLUDED_CONVERSATION_TYPES = new Set(['agentTask'])

/** 自动采集的长度策略区间；显式保存不受此限 */
export const AUTO_MIN_CHARS = 12
export const AUTO_MAX_CHARS = 4000

/**
 * @description 该会话是否允许使用记忆（总开关 + channel 灰度 + conversationType 三重判定）
 * @author xianyang
 * @param {Object} params 判定入参
 * @param {String} params.channel 频道标识
 * @param {String} [params.conversationType] 会话类型
 * @param {Object} [params.options] 请求级覆盖
 * @param {Object} [params.channelMemory] 频道级记忆配置
 * @param {Boolean} [params.globalEnabled] 总开关，缺省读配置
 * @returns {Boolean} 是否启用
 */
export function isMemoryEnabled({channel, conversationType, options = {}, channelMemory, globalEnabled} = {}) {
    const total = globalEnabled ?? (typeof llm !== 'undefined' ? llm.config?.memory?.enabled : false)
    if (!total || !channel) {
        return false
    }
    if (conversationType && EXCLUDED_CONVERSATION_TYPES.has(conversationType)) {
        return false
    }
    /** 请求级只能收窄（关掉），不能替未灰度的频道打开 */
    if (options.memory?.enabled === false || options.memory?.enabled === 0) {
        return false
    }
    if (options.memory?.capture === false && channelMemory?.recall !== true) {
        return false
    }
    return !!(channelMemory?.enabled || channelMemory?.capture || channelMemory?.recall)
}

/**
 * @description 把频道灰度与请求级逃生门合成一份"本轮生效"的记忆开关。
 * 逃生门**只能收窄不能放大**：请求里写 true 不会打开一个频道没开的开关，写 false/0 可以关掉。
 * 之所以要在入口一次性合成，而不是每个下游各自判断：召回、采集、工具三处读的是同一份
 * `channelMemory`，只要有一处漏判，"这个用户这轮别用记忆"就变成"某几处没用"。
 * @author xianyang
 * @param {Object} [channelMemory] 频道灰度
 * @param {Object} [requestMemory] 请求级 `options.memory`
 * @param {Boolean} [globalEnabled] 总开关，缺省读配置
 * @returns {Object} 本轮生效的开关
 */
export function resolveMemory(channelMemory = {}, requestMemory = {}, globalEnabled) {
    const base = channelMemory || {}
    const req = requestMemory || {}
    const total = globalEnabled ?? (typeof llm !== 'undefined' ? Boolean(llm.config?.memory?.enabled) : false)
    const denied = v => v === false || v === 0
    if (!total) {
        return {...base, enabled: false, capture: false, recall: false, tools: false, memoryDenied: false}
    }
    const out = {...base}
    for (const key of ['enabled', 'capture', 'recall']) {
        out[key] = Boolean(base[key]) && !denied(req[key])
    }
    /**
     * 工具默认跟随 recall：只开采集的灰度阶段不该让模型有能力写记忆，
     * 频道显式 `tools: true` 时才允许在 enabled/capture 下挂载。
     */
    out.tools = !denied(req.tools) && (base.tools === true
        ? Boolean(out.enabled || out.recall || out.capture)
        : Boolean(out.recall))
    /** token 预算同样只允许收窄（llm 在全局未初始化时是未声明标识符，必须用 typeof 守护） */
    const reqTokens = Number(req.tokens)
    const globalTokens = (typeof llm !== 'undefined' ? Number(llm.config?.memory?.recall?.tokens) : 0) || 0
    const baseTokens = Number(out.recallTokens) || globalTokens
    if (Number.isFinite(reqTokens) && reqTokens > 0) {
        out.recallTokens = baseTokens > 0 ? Math.min(baseTokens, reqTokens) : reqTokens
    }
    return out
}

/**
 * @description 是否应当采集这一段内容
 * @author xianyang
 * @param {Object} params 判定入参
 * @param {String} params.content 文本
 * @param {Object} [params.provenance] 结构化来源标记
 * @param {Boolean} [params.explicitSave] 是否用户显式要求记住
 * @returns {Boolean} 是否采集
 */
export function shouldCapture({content, provenance = {}, explicitSave = false} = {}) {
    if (typeof content !== 'string' || !content.trim()) {
        return false
    }
    /** 只看结构化来源标记，不靠"像不像报错"的关键词 */
    if (provenance.runtimeError || provenance.captureExclude) {
        return false
    }
    if (explicitSave) {
        return true
    }
    const len = content.trim().length
    return len >= AUTO_MIN_CHARS && len <= AUTO_MAX_CHARS
}

/**
 * @description 归一化请求级 workspaceId（PR-16 ③）。
 * 契约是 chatStreamSchema 的 pattern（字母数字开头 + [. _ -]，≤64）；这里做**二次防御**：
 * 不合法形态一律归 null（视为未提供），绝不做"尽力解析"——
 * 静默改写分区会让记忆写错家，比丢弃更危险。合法值去首尾空白后原样返回。
 * @author xianyang
 * @param {*} raw options.memory.workspaceId
 * @returns {String|null} 合法的工作区标识或 null
 */
export function safeWorkspaceId(raw) {
    if (typeof raw !== 'string') {
        return null
    }
    const t = raw.trim()
    if (!t || t.length > 64 || !/^[0-9a-zA-Z][0-9a-zA-Z._-]*$/.test(t)) {
        return null
    }
    return t
}

/**
 * @description userCode 是否适合做记忆主键。
 * 只做形态判定与共享账号黑名单，签名校验属独立的一轮加固。
 * @author xianyang
 * @param {String} userCode 用户标识
 * @returns {Boolean} 是否安全
 */
export function isSafeUserCode(userCode) {
    if (typeof userCode !== 'string' || userCode.length < 3 || userCode.length > 64) {
        return false
    }
    if (/^(user[-_]?\d+|admin|test|system|service|bot|anonymous)$/i.test(userCode)) {
        return false
    }
    return /^[0-9a-zA-Z_-]+$/.test(userCode)
}

/**
 * @description 时间衰减因子，越旧权重越低但不清零
 * @author xianyang
 * @param {Date|String|Number} insertTime 记录时间
 * @param {Number} tauDays 半衰期（天）
 * @param {Number} [now] 基准时间，便于测试可注入
 * @returns {Number} 0-1 的衰减系数
 */
export function recencyFactor(insertTime, tauDays = 30, now = Date.now()) {
    const t = new Date(insertTime).getTime()
    if (!Number.isFinite(t)) {
        return 0
    }
    const days = Math.max(0, (now - t) / 86400000)
    const tau = tauDays > 0 ? tauDays : 1
    return Math.pow(0.5, days / tau)
}

/**
 * @description 记忆综合排序分
 * @author xianyang
 * @param {Object} params 入参
 * @param {Number} params.lexical 词法/向量原始分
 * @param {Number} [params.confidence] 置信度
 * @param {String} [params.source] 来源
 * @param {Date} [params.insertTime] 记录时间
 * @param {Object} [params.config] 策略配置
 * @param {Number} [params.now] 基准时间
 * @returns {Number} 排序分
 */
export function scoreMemory({lexical = 0, confidence = 0, source = 'auto', insertTime, config: cfg, now} = {}) {
    const weights = cfg?.sourceWeight || {user_save: 3, manual_doc: 2.5, promoted: 1.5, auto: 1}
    const weight = weights[source] ?? 1
    const decay = recencyFactor(insertTime ?? now, cfg?.recall?.recencyTauDays ?? 30, now)
    return lexical * weight * (0.5 + 0.5 * decay) * (0.5 + 0.5 * Math.min(1, Math.max(0, confidence)))
}
