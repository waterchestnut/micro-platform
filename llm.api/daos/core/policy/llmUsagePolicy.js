/**
 * @fileOverview `llmUsage` 表的判据（纯函数层）
 * @module daos/core/policy/llmUsagePolicy
 * @description
 * 放这一层而不是放 `services/`：**"什么算被遗弃"是这张表自己的语义**，
 * dac 依赖它是正方向（dac → policy），services 与探针依赖它也仍然是往下依赖。
 * 反过来把判据写在 `services/core/session/` 里让 dac 去 import，就是分层倒置——
 * 我第一版就是这么写的，退回去了。
 *
 * 更根本的一条：**判据只许存在一份**。
 * 如果 dac 里写一份 mongo 查询、测试里再手写一个判断，两者一旦漂移，
 * 测试会自信地验证一个已经失效的口径（§2E-2 那类"两份同值分家"）。
 */

/** 账本的进度取值（与 `llmUsageSchema.progress` 对齐） */
export const LEDGER_PROGRESS = {
    /** 开局已落账、尚未收尾 */
    PROCESSING: 'processing',
}

/**
 * 判遗弃的默认心跳间隔：**不是拍的数**。
 * 实测 run 墙钟 2.3s / 10.2s / 24.0s，工具链最长 31.2s；心跳只在"每次发起上游调用"时打一笔，
 * 所以相邻两笔的最大间隔 ≈ 一次多轮 run 的总墙钟。取 10 分钟留一个量级余量。
 * **它必须大于一次正常 run 的墙钟**，否则每一次长生成都会被误报成损失。
 */
export const DEFAULT_OLDER_THAN_MS = 600000

/**
 * @description 生成"被遗弃 run"的 mongo 查询条件
 * @param {Object} params 参数
 * @param {Number} [params.olderThanMs] 多久没心跳算遗弃
 * @param {Function} [params.now] 时间源（测试注入）
 * @returns {{progress: String, updateTime: Object}} 查询条件
 */
export function abandonedQuery({olderThanMs = DEFAULT_OLDER_THAN_MS, now = Date.now} = {}) {
    return {
        progress: LEDGER_PROGRESS.PROCESSING,
        updateTime: {$lt: new Date(now() - olderThanMs)},
    }
}

/**
 * @description 生成"把仍在中途的账本行收尾"的条件更新过滤器
 * @param {Object} params 参数
 * @param {String} params.messageCode 本轮标识
 * @param {String} [params.progress] 要求当前处于的状态（默认只认 processing）
 * @returns {{messageCode: String, progress: String}} 查询条件
 * @description
 * `progress` 这一项是这条方法的**全部意义**，所以单独抽成纯函数来测：
 * 少了它，路由补写档案时的收尾就会把 run 自己刚写的 `finish` 覆盖成 `error`——
 * 一轮成功的对话在数据上变成失败的，比原来"少一行档案"坏得多。条件更新让"谁抢到谁说话"成为唯一结果。
 */
export function finalizeFilter({messageCode = '', progress = LEDGER_PROGRESS.PROCESSING} = {}) {
    if (!messageCode) {
        throw new Error('messageCode 不能为空（条件更新没有键就会命中整个集合）')
    }
    return {messageCode, progress}
}

/**
 * @description 单条记录是否算被遗弃（与 `abandonedQuery` 同语义，供内存侧核对与断言）
 * @param {Object} params 参数
 * @param {String} params.progress 该行的 progress
 * @param {Date|Number} [params.updateTime] 最后一次心跳
 * @param {Number} [params.olderThanMs] 判遗弃的心跳间隔
 * @param {Function} [params.now] 时间源
 * @returns {Boolean} 是否被遗弃
 */
export function isAbandonedRun({progress, updateTime, olderThanMs = DEFAULT_OLDER_THAN_MS, now = Date.now} = {}) {
    if (progress !== LEDGER_PROGRESS.PROCESSING) {
        return false
    }
    const t = updateTime instanceof Date ? updateTime.getTime() : Number(updateTime)
    if (!Number.isFinite(t)) {
        /** 没有心跳时间的 processing 行按遗弃算：宁可多查出来让人看一眼，也别漏掉真丢的轮次 */
        return true
    }
    /**
     * 与查询条件严格同向：`abandonedQuery` 用的是 `updateTime: {$lt: cutoff}`（**不含等于**），
     * 所以这里必须是 `>` 而不是 `>=`。
     * 这条不是吹毛求疵：交叉断言第一次跑就把 `>=` 抓了出来——在 `now - t === olderThanMs`
     * 那一毫秒上，"查询说不是遗弃、predicate 说是"，两套规则就这样在边界上分家。
     */
    return now() - t > olderThanMs
}

/**
 * @description 校验阈值是否安全（防止被调成比一次正常 run 还短）
 * @param {Number} olderThanMs 配置值
 * @param {Number} [maxRunMs] 已知的最长 run 墙钟
 * @returns {{ok: Boolean, reason: String}} 判定
 */
export function validateOlderThan(olderThanMs, maxRunMs = 31200) {
    const v = Number(olderThanMs)
    if (!Number.isFinite(v) || v <= 0) {
        return {ok: false, reason: `olderThanMs 必须是正数毫秒，当前 ${olderThanMs}`}
    }
    /** 至少 3 倍余量：心跳不是定周期，长 run 里相邻两笔的间隔本身就会拉长 */
    return v >= maxRunMs * 3
        ? {ok: true, reason: ''}
        : {ok: false, reason: `olderThanMs=${v} 小于最长 run 墙钟 ${maxRunMs} 的 3 倍，会把正常在途误判成损失`}
}
