/**
 * @fileOverview 翻译链路的上游客户端：把退避与熔断接到此前直连的调用上
 * @module services/core/upstreamTransClient
 * @description
 * 存在理由：`PR-0.5 统一了上游调用`这句话此前**只对 chat 主循环成立**。
 * `services/core/trans.js` 里有 3 处自建 `new OpenAI(...)` 与 4 处 `chat.completions.create`，
 * 完全绕过退避与熔断——也就是说同一个 relay 出口在"翻译挂了"的时候既不会退避，
 * 也不会让熔断器看到失败，而 D39 要救的恰恰是"出口整体不可用"。
 *
 * 为什么是薄封装而不是重写调用点：翻译的 4 个请求体都很长（含 OCR 的多段 prompt 与图片数组），
 * 搬动它们的收益为零、出错面积很大。`trans.js` 实际只用到 `chat.completions.create` 一个方法，
 * 所以这里只替那一个方法，其余保持原样。
 *
 * 三个口径与 chat 主循环**逐字一致**（不是"类似"）：
 * - SDK 隐式重试在启用退避时显式设 0，避免"我们的重试 × SDK 的重试"叠乘；
 * - `Retry-After` 优先于自算退避（同一个 `parseRetryAfterMs`）；
 * - 熔断键取**当次那一档**的出口 origin，所以 VL 档与 flash 档各按自己的出口记账。
 *
 * 一处刻意不同：翻译**不换档**。`fallbackModel` 会换掉模型族，译文风格随之变化，
 * 而翻译不是"必须成功"的主链路——宁可失败也不悄悄换一种口味。
 */

/**
 * 超时的默认参数。**由 dev 实测拟合，不是设计值**：
 * `autoTrans` 8 个真实样本（34→1822ms、102→2445ms、137→2625ms、332→6537ms，0 错误）
 * 线性拟合约 **15.8ms/字 + 1.28s**；这里取 `perCharMs=30`（≈1.9 倍余量）与 `baseMs=30000`
 * （≈实测 332 字最坏值 7.5s 的 4 倍）。上限 120s 是给 8000 字这条业务硬顶留的空间。
 * 为什么不做成一个固定值：翻译耗时与输入长度强相关，固定值要么掐死长文本、要么形同没有。
 */
export const TRANS_TIMEOUT_DEFAULTS = {
    baseMs: 30000,
    perCharMs: 30,
    maxMs: 120000,
    minMs: 2000,
}

/**
 * @description 数请求体里的字符量（system+user 文本、图片消息按固定字数计）
 * @param {Object} body chat.completions 请求体
 * @returns {Number} 字符数
 */
export function bodyChars(body = {}) {
    let n = 0
    for (const msg of body.messages || []) {
        const c = msg?.content
        if (typeof c === 'string') {
            n += c.length
        } else if (Array.isArray(c)) {
            for (const part of c) {
                /** 系统提示词也算：它是每次都发出去的固定成本 */
                if (part?.type === 'text' && typeof part.text === 'string') {
                    n += part.text.length
                }
                /**
                 * 图片部件**故意不计入**。OCR 的耗时我没有任何实测样本（仓库里没有可访问的测试图，
                 * 拿假 URL 量到的是模型取图失败的路径，不是 OCR），所以这里不放一个"看起来合理"的等效字数。
                 * 含图的请求由 `create()` 判为"未测过 ⇒ 不加超时"，保持改造前的默认行为。
                 */
            }
        }
    }
    return n
}

/**
 * @description 请求体里是否含图片部件
 * @param {Object} body chat.completions 请求体
 * @returns {Boolean} 结果
 */
export function bodyHasImage(body = {}) {
    for (const msg of body.messages || []) {
        const c = msg?.content
        if (Array.isArray(c) && c.some(part => part?.type === 'image_url')) {
            return true
        }
    }
    return false
}

/**
 * @description 按长度算本次调用的超时（clamp 到 [minMs, maxMs]）
 * @param {Object} params 参数
 * @param {Number} params.chars 请求体字符数
 * @param {Object} [params.cfg] 覆盖项
 * @returns {Number} 毫秒
 */
export function resolveTransTimeout({chars = 0, cfg = {}} = {}) {
    const base = Number(cfg.baseMs) > 0 ? Number(cfg.baseMs) : TRANS_TIMEOUT_DEFAULTS.baseMs
    const per = Number.isFinite(Number(cfg.perCharMs)) ? Math.max(0, Number(cfg.perCharMs)) : TRANS_TIMEOUT_DEFAULTS.perCharMs
    const max = Number(cfg.maxMs) > 0 ? Number(cfg.maxMs) : TRANS_TIMEOUT_DEFAULTS.maxMs
    const min = Number(cfg.minMs) > 0 ? Number(cfg.minMs) : TRANS_TIMEOUT_DEFAULTS.minMs
    return Math.min(max, Math.max(min, Math.round(base + per * Number(chars || 0))))
}

/**
 * @description 造一个带退避与熔断的上游客户端（依赖全部注入，因此可离线测）
 * @param {Object} params 参数
 * @param {Object} params.modelConfig 当次档位（要 apiKey/baseURL/key）
 * @param {Function} params.makeRaw 返回原始 openai 客户端的工厂（便于注入 SDK）
 * @param {Object} params.retryCfg 退避配置（`config.upstreamRetry` 的形态）
 * @param {Object} params.breaker 熔断器（可为 null ⇒ 只走退避）
 * @param {Function} params.keyOf 出口键计算
 * @param {Function} params.withUpstreamRetry 退避包装函数
 * @param {Function} params.parseRetryAfterMs 解析 Retry-After
 * @param {Object} [params.timeoutCfg] 超时参数（`config.trans.timeout` 的形态）
 * @param {Function} [params.log] 观测回调
 * @returns {{chat: {completions: {create: Function}}}} 鸭子类型客户端
 */
export function createTransClient({
    modelConfig,
    makeRaw,
    retryCfg = {},
    breaker = null,
    keyOf = null,
    withUpstreamRetry,
    parseRetryAfterMs,
    timeoutCfg = {},
    log = () => {},
}) {
    if (!modelConfig || typeof modelConfig.apiKey !== 'string') {
        throw new Error('createTransClient: 缺少有效的 modelConfig')
    }
    /** 与 llmChat 同一判据：启用我们自己的重试时，SDK 那一层必须显式关掉 */
    const raw = makeRaw({
        apiKey: modelConfig.apiKey,
        baseURL: modelConfig.baseURL,
        maxRetries: retryCfg.enabled === true ? 0 : undefined,
    })
    return {
        chat: {
            completions: {
                /**
                 * @description 只替换 trans 真正用到的那一个方法
                 * @param {Object} body 请求体
                 * @param {Object} [opts] SDK 选项（原样透传）
                 * @returns {Promise<Object>} 上游响应
                 */
                create: async (body, opts) => {
                    /**
                     * 超时是**按本次请求体长度算**的（模块注释给了拟合来源）。
                     * 含图片时 `timeoutMs = null`：没测过的东西不配拥有系数，也就配不上一个超时。
                     */
                    const withImage = bodyHasImage(body)
                    const chars = bodyChars(body)
                    const timeoutMs = withImage ? null : resolveTransTimeout({chars, cfg: timeoutCfg})
                    /**
                     * 调用方显式给的 timeout 优先——策略是"没人指定时才有意见"。
                     * （上一版写成 {...opts, timeout}，会把显式值覆盖掉，是这次用例抓出来的。）
                     */
                    const reqOpts = (timeoutMs && !(opts && opts.timeout)) ? {...(opts || {}), timeout: timeoutMs} : opts
                    if (timeoutMs) {
                        log({note: 'trans 本次超时', chars, timeoutMs})
                    }
                    const ret = await withUpstreamRetry({
                        /** 翻译不换档：见模块注释。留空 fallbackModel 是最直白的表达 */
                        cfg: {...retryCfg, fallbackModel: ''},
                        breaker,
                        breakerKeyOf: breaker && keyOf ? () => keyOf({modelConfig}) : undefined,
                        invoke: async () => raw.chat.completions.create(body, reqOpts),
                        retryAfterMsOf: (e) => parseRetryAfterMs(e?.headers),
                        log,
                    })
                    return ret.value
                },
            },
        },
    }
}
