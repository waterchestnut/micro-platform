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
 * @description 造一个带退避与熔断的上游客户端（依赖全部注入，因此可离线测）
 * @param {Object} params 参数
 * @param {Object} params.modelConfig 当次档位（要 apiKey/baseURL/key）
 * @param {Function} params.makeRaw 返回原始 openai 客户端的工厂（便于注入 SDK）
 * @param {Object} params.retryCfg 退避配置（`config.upstreamRetry` 的形态）
 * @param {Object} params.breaker 熔断器（可为 null ⇒ 只走退避）
 * @param {Function} params.keyOf 出口键计算
 * @param {Function} params.withUpstreamRetry 退避包装函数
 * @param {Function} params.parseRetryAfterMs 解析 Retry-After
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
                    const ret = await withUpstreamRetry({
                        /** 翻译不换档：见模块注释。留空 fallbackModel 是最直白的表达 */
                        cfg: {...retryCfg, fallbackModel: ''},
                        breaker,
                        breakerKeyOf: breaker && keyOf ? () => keyOf({modelConfig}) : undefined,
                        invoke: async () => raw.chat.completions.create(body, opts),
                        retryAfterMsOf: (e) => parseRetryAfterMs(e?.headers),
                        log,
                    })
                    return ret.value
                },
            },
        },
    }
}
