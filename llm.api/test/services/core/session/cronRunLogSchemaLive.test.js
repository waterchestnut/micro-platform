/**
 * @fileOverview cronRunLog schema 的 default 函数活体用例（2026-11-17 事故回归位）
 * @module test/services/core/session/cronRunLogSchemaLive
 * @description
 * 事故本体：cronRunLogSchema 漏了家族规矩 `const tools = llm.tools`，logCode 的
 * default 在运行期裸引用 tools——cron pod 每 10 分钟整族写档失败
 * （"CronRunLog validation failed: logCode: tools is not defined"），曲线首条永远 0 行。
 * 判据用例（cronRunRecord.test）全绿而线上全红的原因：**buildRunRecord 纯函数不含
 * logCode（schema default 生成），default 函数只有落库路径才碰**——离线测试面够不到
 * mongoose 构造，就成了结构性盲区。
 * 本件的补法：给 mongoose 注入 create 桩，让 schema 真实构造走一遍——
 * default 函数执行不抛 + logCode 成形，"tools is not defined" 从此离线可抓。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'

// 全局形状照 llm.api init 的最小面（schema 模块级读 llm.tools）
globalThis.llm = globalThis.llm || {
    tools: {getUUID: () => 'a'.repeat(32)},
    config: {mongodbConfig: {options: {}}},
    logger: {info() {}, warn() {}, error() {}},
}

const created = []
// create 桩：走真实文档构造（default 在构造期执行——这正是事故要抓的那一步），不碰 mongo
mongoose.Model.create = async function (doc) {
    const built = new this(doc)
    created.push(built)
    return built
}

// schema 默认导出（model 编译在 daos/core/schema/index.js，离线测试自编译）
const cronRunLogSchema = (await import('../../../../daos/core/schema/cronRunLogSchema.js')).default
const CronRunLog = mongoose.models.CronRunLogTest || mongoose.model('CronRunLogTest', cronRunLogSchema)

describe('cronRunLog default 函数活体（事故回归位）', () => {
    test('构造走 default 不抛，logCode 成形（tools is not defined 离线可抓）', async () => {
        const doc = new CronRunLog({task: 'retention', at: new Date(), ms: 12, result: {mode: 'dry'}})
        const err = doc.validateSync()
        assert.equal(err, undefined, `校验不该失败：${err?.message}`)
        assert.equal(typeof doc.logCode, 'string')
        assert.ok(doc.logCode.length > 0, 'logCode 必须由 default 生成')
    })
    test('create 路径同样过（retention.js 的真实调用形态）', async () => {
        const doc = await CronRunLog.create({task: 'agentTaskRecover', at: new Date(), ms: 3, result: {}})
        assert.ok(created.length >= 1)
        assert.ok(doc.logCode, 'create 出来的文档 logCode 在位')
    })
    test('家族规矩字面在位（裸引用防线：schema 文件必须有 llm.tools 解构行）', () => {
        const file = path.resolve(process.cwd(), 'daos/core/schema/cronRunLogSchema.js')
        const code = fs.readFileSync(file, 'utf8').replace(/\r/g, '')
        assert.ok(code.includes('const tools = llm.tools'),
            'schema 顶部必须有家族解构行——default 函数运行期靠它')
    })
})
