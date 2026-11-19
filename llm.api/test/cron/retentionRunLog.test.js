/**
 * @fileOverview cronRunLog 写点与任务体返回值的装配锚守卫（runGuarded 单点，五体三态）
 * @module test/cron/retentionRunLog
 * @description
 * 档案面观测的装配形状：写点必须在 runGuarded **单点**（散到任务体=漏一个任务断一段曲线）；
 * 五个任务体各自的 skip/catch/成功返回必须齐（返回值语义=buildRunRecord 的输入契约）；
 * 仪器写失败必须被吞（观测件不成故障源——decideGateFallback 同款）；TTL 索引在位（自动清理）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, 'cron/retention.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const src = fs.readFileSync(path.join(SRC, 'cron/retention.js'), 'utf8').replace(/\r/g, '')
const schema = fs.readFileSync(path.join(SRC, 'daos/core/schema/cronRunLogSchema.js'), 'utf8').replace(/\r/g, '')
const NAMES = ['retention', 'agentTaskRecover', 'abandonedBackfill', 'sleepTimeConsolidate', 'artifactReconcile']

describe('1 runGuarded 单点写', () => {
    test('recordCronRun 只在 runGuarded 出现（成功+兜底两处），任务体零散点', () => {
        assert.equal(src.split('await recordCronRun(').length - 1, 2, '写点必须恰为成功/异常两处')
        const fn = src.slice(src.indexOf('async function runGuarded'), src.indexOf('async function recordCronRun'))
        assert.ok(fn.includes('const ret = await body()') && fn.includes('startedAt'), 'at=进入时刻、ret=任务体返回')
    })
    test('仪器吞错：recordCronRun 的 catch 只记日志不再抛（观测件不成故障源）', () => {
        const fn = src.slice(src.indexOf('async function recordCronRun'))
        const body = fn.slice(0, fn.indexOf('\n}') + 2)
        assert.ok(body.includes('catch'), '必须吞错')
        assert.ok(!/throw/.test(body), '吞错函数自己绝不抛')
        assert.ok(body.includes('buildRunRecord'), '形状出自判据单源')
    })
})

describe('2 五任务体三态返回齐', () => {
    for (const n of NAMES) {
        test(`${n}：skipped/abnormal/return ret 三态齐`, () => {
            assert.ok(src.includes(`return {skipped: true}`.replace('true}', `true}`)), 'skip 态')
            const i = src.indexOf(`runGuarded('${n}'`)
            assert.ok(i >= 0)
            const seg = src.slice(i, i + 1800)
            assert.ok(seg.includes("return {skipped: true}"), `${n} skip 未返回 skipped`)
            assert.ok(seg.includes('return {abnormal: String(e.message || e).slice(0, 300)}'), `${n} catch 未返回 abnormal`)
            assert.ok(seg.includes('return ret'), `${n} 成功未返回 ret`)
        })
    }
    test('写失败兜底：skip 态返回在 executing 分支内（不是 drain 停机分支——停机轮不记档案，那是"进程不在"不是"任务没跑"）', () => {
        const drainSeg = src.slice(src.indexOf('async function runGuarded'), src.indexOf('try {', src.indexOf('async function runGuarded')))
        assert.ok(!drainSeg.includes('recordCronRun'), '停机分支保持不写档案')
    })
})

describe('3 schema 与注册', () => {
    test('TTL 30 天与任务索引在位', () => {
        assert.ok(schema.includes('expireAfterSeconds: 30 * 24 * 3600'), 'TTL 必须在位——这是曲线不是业务数据')
        assert.ok(/\{task: 1, at: -1\}/.test(schema))
    })
    test('Model 注册名与集合名（读数仪 import CronRunLog 依赖）', () => {
        const idx = fs.readFileSync(path.join(SRC, 'daos/core/schema/index.js'), 'utf8').replace(/\r/g, '')
        assert.ok(idx.includes("conn.model('CronRunLog', cronRunLogSchema, 'cronRunLog')"))
    })
})
