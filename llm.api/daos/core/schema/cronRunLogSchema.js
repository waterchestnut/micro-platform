/**
 * @fileOverview cron 任务 firing 的档案面记录（"这事不用翻日志了"家族，scan-abandoned-runs 先例）
 * @author xianyang
 * @module daos/core/schema/cronRunLogSchema
 * @description
 * 立档理由（2026-11-16 三日连续实锤）：cron 的 firing 读数此前只活在 cron pod 的 stdout——
 * llm.api 任何推送都重启该 pod，当日 firing 行随旧容器消失，观察样本连着断三天。
 * 日志侧观测对"每天推多次代码"的节奏结构性不可靠，档案侧才免疫。
 * 写入单点在 `cron/retention.js` 的 runGuarded（一轮一行）；记录形状判据在
 * `services/core/session/cronRunRecord.js`（纯函数，构造/落库分离）。
 * TTL 30 天：这是观察曲线不是业务数据，到期自动清，不需要 retention 任务再管它。
 */

import mongoose from 'mongoose'

const {Schema} = mongoose
/** 家族规矩（conversationSchema 等全数如此）：tools 必须从 llm 全局取——漏这行时
 *  schema default 在运行期裸引用 tools，cron pod 直接 "tools is not defined"
 *  （2026-11-17 首次 firing 全数写档失败实锤；纯函数用例碰不到 default，抓不住） */
const tools = llm.tools

/**
 * @typedef {Object} CronRunLog 一轮 cron firing 的记录
 * @property {String} logCode 标识
 * @property {String} task 任务名（retention/agentTaskRecover/abandonedBackfill/sleepTimeConsolidate/artifactReconcile）
 * @property {Date} at 触发时刻（runGuarded 进入即记，非完成时刻——曲线横轴要的是"到点没有"）
 * @property {Number} ms 本轮耗时
 * @property {Object} result 任务返回的结构化摘要（模式/计数/动作数；异常轮含 abnormal、叠跑轮含 skipped）
 * @property {Date} insertTime 落库时刻（TTL 锚）
 */

const cronRunLogSchema = new Schema({
    logCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '标识',
        required: true,
    },
    task: {type: String, description: '任务名', required: true},
    at: {type: Date, description: '触发时刻', required: true},
    ms: {type: Number, description: '本轮耗时'},
    result: {type: Schema.Types.Mixed, description: '结构化摘要（异常轮 abnormal/叠跑轮 skipped）'},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '落库时刻',
    },
})

cronRunLogSchema.index({task: 1, at: -1})
/** TTL 30 天：观察曲线，不是业务数据 */
cronRunLogSchema.index({insertTime: 1}, {expireAfterSeconds: 30 * 24 * 3600})

export default cronRunLogSchema
