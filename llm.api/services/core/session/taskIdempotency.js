/**
 * @fileOverview 任务幂等判据（PR-任务编排 §4-1，纯函数）
 * @module services/core/session/taskIdempotency
 * @description
 * 两类幂等面共用（serialized-turn 键=params.messageCode / 编排 root 键=params.idemKey）：
 * 命中判、重复键错误识别、预查 filter 构造。DB 侧由 agentTaskSchema 的 partial-unique 索引兜并发，
 * 本件管"先查后插 + E11000 回查返回既有行"的判定形状——一切模糊向"不猜命中"收。
 */

/**
 * @description 幂等键命中判定（M4b 幂等）：只认 key 精确相等的行（查询已被 filter 约束，这里是二次核对——
 * 防调用方把 filter 拼错后"把别人的任务当自己的幂等命中"，那比没幂等更糟）。
 * @param {Object} p
 * @param {Array} [p.rows] 候选行（agentTask）
 * @param {String} [p.keyField] 幂等键所在 params 子字段名（'idemKey' | 'messageCode'）
 * @param {String} [p.keyValue] 期望的键值
 * @returns {Object|null} 命中的**最旧**一行（rootCode 稳定：幂等响应必须回同一个 id，不能两次各指一行）
 */
export function pickIdempotentHit({rows = [], keyField, keyValue} = {}) {
    if (!keyField || !keyValue) return null;
    const hits = (Array.isArray(rows) ? rows : []).filter((r) => r && String(r.params?.[keyField] ?? '') === String(keyValue));
    if (!hits.length) return null;
    // 查询侧本就按 insertTime 升序取，这里再兜一层：不依赖调用方排序也拿到最旧
    return hits.slice().sort((a, b) => new Date(a.insertTime || 0).getTime() - new Date(b.insertTime || 0).getTime())[0];
}

/**
 * @description 判"唯一索引冲突"（E11000）。bulkWrite 的错误形状不止一种顶层 code——
 * 顶层 / writeErrors[] / 消息文本三处都要认，漏一处并发分支就当普通失败吞了。
 * @param {any} e
 * @returns {Boolean}
 */
export function isDuplicateKeyError(e) {
    if (!e) return false;
    if (Number(e.code) === 11000) return true;
    if (Array.isArray(e.writeErrors) && e.writeErrors.some((w) => Number(w?.code) === 11000)) return true;
    return /E11000|duplicate\s*key/i.test(String(e.message || ''));
}

/**
 * @description 幂等预查的 complexFilter 单一构造点（两处调用方共用，防 filter 形状分叉）
 * @param {Object} p
 * @param {String} p.conversationCode 会话（幂等作用域=会话内）
 * @param {String} p.agentRole 'root' | 'serialized-turn'
 * @param {String} p.keyField params 里的键字段
 * @param {String} p.keyValue 键值
 * @param {Boolean} [p.waitingOnly] true ⇒ 仅未执行行（handleStatus:0，用于 serialized-turn：跑完的同码允许再入）
 * @returns {Object} agentTaskDac.getTop 可用的 {complexFilter}
 */
export function buildIdemFilter({conversationCode, agentRole, keyField, keyValue, waitingOnly = true} = {}) {
    const f = {conversationCode, agentRole, [`params.${keyField}`]: keyValue};
    if (waitingOnly) f.handleStatus = 0;
    return {complexFilter: f};
}

export default {pickIdempotentHit, isDuplicateKeyError, buildIdemFilter};
