/**
 * @fileOverview 「重新生成」的服务端口径（P3 最小安全版，纯函数）
 * @module services/core/session/regeneration
 * @description
 * 产品口径是你定的那一条：**只对最后一条回答重新生成、复用同一个问题、旧答案保留、界面先说费用**。
 * 服务端只负责两件不能靠前端自觉的事：
 *
 * 1. **重新生成绝不能命中答案缓存**。
 *    缓存的键是 (query, channel, model)，重新生成时这三样一个都没变 ⇒
 *    不显式绕开的话，按钮点下去会把**同一条缓存答案**再发一遍：用户付了一次 HTTP 往返、
 *    看到"重新生成"完成，实际一个字都没变。这不是理论风险——缓存命中路径在
 *    `llmChat` 里就排在模型调用之前，而它读的 `options.cache` 由前端传。
 *    所以这条判据必须在服务端，不能写成"前端记得传 cache:false"。
 *
 * 2. **来源要能被核对**。档案里留下 `regeneratedFrom = 被替换那条的 messageCode`，
 *    于是"这一轮是重跑出来的"在数据上可查，而不是只体现在界面上。
 *    旧答案不删（那是产品口径的一部分：可能已经被引用）。
 *
 * 值本身一律宽容接收、严格归一：不是非空字符串就当没有，
 * 免得前端多传一个对象就把这一轮变成 error 行（与 H1"读不懂不等于 0"同一条道理）。
 */

/** 与 messageCode 同形状：库里那一列就是这么长的 */
const MAX_CODE_LEN = 128

/**
 * @description 把前端传来的来源标识归一成 `string|null`
 * @param {Object} v `options.regeneratedFrom`
 * @returns {String|null} 结果
 */
export function normalizeRegeneratedFrom(v) {
    if (typeof v !== 'string') {
        return null
    }
    const s = v.trim()
    if (!s || s.length > MAX_CODE_LEN) {
        return null
    }
    return s
}

/**
 * @description 这一轮能不能走答案缓存
 * @param {Object} params 参数
 * @param {Boolean} params.cacheEligible 原本的缓存资格（会话无历史等条件算出来的）
 * @param {String|null} [params.regeneratedFrom] 归一后的重新生成来源
 * @returns {Boolean} 能不能读/写答案缓存
 *
 * 写成函数而不是在链路里加一个 `&&`：这样"重生成绕缓存"这件事有一条可穷举测的判据，
 * 而不是散在 if 里、等下一次重构时被顺手抹掉。
 */
export function allowsAnswerCache({cacheEligible = false, regeneratedFrom = null} = {}) {
    if (regeneratedFrom) {
        return false
    }
    return cacheEligible === true
}

/**
 * @description 落库该写哪个来源值（没有时写 null，不写缺键）
 * @param {String|null} regeneratedFrom 归一后的值
 * @returns {String|null} 结果
 *
 * 显式 `null` 与"这个键不存在"是两件事：前者是"确认这一轮不是重跑"，
 * 后者是"这一行的写法还不知道这件事"（H1 的教训：缺键与 0 不能混读）。
 */
export function regeneratedFromForArchive(regeneratedFrom) {
    return typeof regeneratedFrom === 'string' && regeneratedFrom ? regeneratedFrom : null
}
