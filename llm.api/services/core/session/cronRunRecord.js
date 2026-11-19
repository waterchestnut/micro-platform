/**
 * @fileOverview cron firing 记录形状的判据（构造与落库分离——形状可穷举）
 * @module services/core/session/cronRunRecord
 * @description
 * 一轮 runGuarded 的四种结局在此编译成档案行（2026-11-16 立档的语义底座）：
 *   - 正常轮：任务体返回结构化摘要（模式/计数/动作数）⇒ result=ret；
 *   - 叠跑跳过轮：任务体返回 {skipped:true} ⇒ 曲线上的"到点但没跑"；
 *   - 异常轮：任务体 catch 返回 {abnormal:msg}，或 body 直接抛（runGuarded 兜底）⇒ abnormal；
 *   - 无结构轮：ret undefined（任务体没返回值的历史形态）⇒ noStructuredResult 如实声明，
 *     不冒充成功——"读数缺失"与"读数正常"必须是两个可区分的档案态。
 * 写失败不许成为故障源（decideGateFallback 同款规矩）：落库异常由调用侧吞并记日志，
 * 本件只保证形状永远构造得出来。
 */

/** 异常消息进档案的截断位（错误里可能带数据片段，300 字符够定位且不养大文档） */
export const ABNORMAL_MAX = 300

/**
 * @description 一轮 firing 的档案行（不含 logCode，schema default 生成）
 * @param {Object} args 参数
 * @param {String} args.name 任务名
 * @param {Date} args.startedAt 触发时刻（runGuarded 进入即记——曲线横轴要"到点没有"）
 * @param {Number} args.ms 本轮耗时
 * @param {Object|undefined} [args.ret] 任务体返回值
 * @param {Error|String} [args.error] runGuarded 兜底捕获的抛错
 * @returns {{task:String, at:Date, ms:Number, result:Object}}
 */
export function buildRunRecord({name, startedAt, ms = 0, ret, error} = {}) {
    let result
    if (error) {
        result = {abnormal: String(error?.message || error).slice(0, ABNORMAL_MAX)}
    } else if (ret === undefined) {
        result = {noStructuredResult: true}
    } else if (ret === null) {
        result = {abnormal: '(null result)'}
    } else if (typeof ret !== 'object') {
        result = {value: String(ret).slice(0, ABNORMAL_MAX)}
    } else {
        result = ret
    }
    return {task: String(name || '(未名)'), at: startedAt || new Date(), ms, result}
}

/**
 * @description 档案行是否算"本轮真实执行了"（读数仪的 fires 判据——单源在这）
 * @param {Object} row cronRunLog 行
 * @returns {Boolean}
 */
export function isExecutedFiring(row) {
    const r = row?.result
    if (!r || typeof r !== 'object') {
        return false
    }
    return !r.skipped && !r.abnormal && !r.noStructuredResult
}

export default {ABNORMAL_MAX, buildRunRecord, isExecutedFiring}
