/**
 * @fileOverview world-time 判据（D31：事实"在现实里何时成立"，与 system-time 的"我们何时改口"正交）
 * @module services/core/memory/worldTime
 * @description
 * memoryAtom 已有 system-time 权威（supersededBy/mergedFrom/journal）——那是**认识论**时间；
 * `validFrom/invalidAt/invalidReason` 是**本体论**时间。"三月时我们相信什么"（考古）与
 * "三月时现实是什么"（as-of）是两个查询，别再拿前者硬答后者。
 *
 * 本模块只放纯判据：
 * - `isValidAt(atom, at)`：JS 侧权威谓词（含与不含边界的口径都写死并有测试）；
 * - `asOfFilter(at)`：mongo 查询构造器，**与谓词逐条件对映**（一致性由测试钉，线上真库行为在读数窗口复核）；
 * - 词表与 `daos/core/schema/memoryAtomSchema.WORLD_INVALID_REASONS` 集合相等由测试守（跨层防漂移，同 artifactSchema↔INTAKE_STATE 先例）。
 *
 * 边界口径（定了就不许两头飘）：`validFrom` **含**（到点即生效）；`invalidAt` **不含**（到点已失效）。
 * 理由：同一时刻上"旧事实失效、新事实生效"必须一真一假——两头都含会让矛盾事实同刻共存，
 * 两头都不含会造出一刻事实真空。
 */

/** 与 schema 词表同源（测试断言集合相等） */
export const WORLD_INVALID_REASONS = ['superseded', 'retired', 'expired']

const toMs = (v) => {
    if (v === null || v === undefined || v === '') return null
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
    return Number.isFinite(t) ? t : null
}

/**
 * @description 某原子的**世界时间窗**是否覆盖时刻 at
 * @param {Object} atom 带 validFrom/invalidAt 的原子（或同形对象）
 * @param {Date|Number|String} [at] 时刻，缺省当前
 * @returns {Boolean} 是否有效
 */
export function isValidAt(atom, at = Date.now()) {
    if (!atom || typeof atom !== 'object') return false   // 不存在的原子谈不上"何时有效"——恒 false，别让空对象语义混进来
    const t = toMs(at)
    if (t === null) return false
    const from = toMs(atom.validFrom)
    const to = toMs(atom.invalidAt)
    if (from !== null && from > t) return false
    if (to !== null && to <= t) return false
    return true
}

/**
 * @description 造 as-of 的 mongo 过滤片段（与 isValidAt 逐条件对映）
 *
 * mongo 里 `字段: null` 同时匹配"缺失"与"null 值"——正是这里要的"没记 = 不设界"语义；
 * Date 构造保证与 schema 的 Date 列同型比较。
 * @param {Date|Number|String} at 时刻
 * @param {Object} [extra] 追加的 $and 条件（命名空间等）
 * @returns {Object} 查询 filter
 */
export function asOfFilter(at = Date.now(), extra = {}) {
    const when = new Date(at)
    return {
        $and: [
            {$or: [{validFrom: null}, {validFrom: {$lte: when}}]},
            {$or: [{invalidAt: null}, {invalidAt: {$gt: when}}]},
            ...(extra && Object.keys(extra).length ? [extra] : []),
        ],
    }
}

/**
 * @description 失效动作的守卫：给原子盖失效时刻时的最小一致性检查（不通过就抛，让调用方修数据而不是写坏账）
 * @param {Object} params {now, validFrom, invalidAt} 各时刻可空
 * @returns {Object} {invalidAt} 规范化结果（Date）
 */
export function assertValidTransition({now = Date.now(), validFrom = null, invalidAt} = {}) {
    const bad = (m) => { throw new Error(`world-time 失效不合法：${m}`) }
    if (!invalidAt) bad('invalidAt 缺失——失效动作必须给时刻')
    const to = toMs(invalidAt)
    const from = toMs(validFrom)
    if (to === null) bad('invalidAt 不是可比时刻')
    if (from !== null && to < from) bad('invalidAt 早于 validFrom（倒着失效）')
    if (to > toMs(now)) bad('invalidAt 在未来——那是预测，不是失效')
    return {invalidAt: new Date(to)}
}

export default {WORLD_INVALID_REASONS, isValidAt, asOfFilter, assertValidTransition}
