/**
 * @fileOverview M1-c 刀 1（事件镜像+发射+读面）的接线与形状守卫
 * @module test/services/agent/taskEventWiring.test
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readCode = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('发射点位（五处，全部走 emitTaskEvents 单口）', () => {
    test('plannerService：受理段 task_queued+subtask_spawned（title 从 plan.subtasks 按序 zip——format 就地改写的 simpleSubs 没有 title）', () => {
        const code = readCode('services/agent/fanOutPlannerService.js')
        assert.match(code, /import \{ emitTaskEvents \} from '\.\/taskEventEmit\.js'/)
        assert.match(code, /type: 'task_queued'[\s\S]{0,200}type: 'subtask_spawned'/)
        assert.match(code, /plan\.subtasks\?\.\[i\]\?\.title/)
    })
    test('agentChat：child 终局 fire-and-forget（.catch 兜住——事件旁路不许拖慢 child，也不许 unhandled）', () => {
        const code = readCode('services/agent/handler/agentChat.js')
        assert.match(code, /emitTaskEvents\(\{[\s\S]{0,800}\}\)\.catch\(\(\) => \{\}\)/)
        assert.match(code, /type: 'subtask_done'/)
        assert.match(code, /type: 'subtask_failed'/)
        assert.match(code, /agentTaskInfo\.parentCode/)
    })
    test('finalizeTask：await 段收口 await-input；schedule 里程碑不收段；段尾仲裁+__end__', () => {
        const code = readCode('services/agent/handler/fanOutFinalizeTask.js')
        assert.match(code, /end: 'await-input'/)
        assert.match(code, /if \(timing\.act === 'schedule'\) \{[\s\S]{0,300}type: 'synthesizing'/)
        assert.match(code, /type: 'arbitration'[\s\S]{0,300}end: finFinal\.action/)
    })
    test('clarifyAnswer 端点：答复开新段（task_started+subtask_spawned）', () => {
        const code = readCode('routes/core/agentTask/root.js')
        assert.match(code, /const \{emitTaskEvents\} = await import\('\.\.\/\.\.\/\.\.\/services\/agent\/taskEventEmit\.js'\)/)
        assert.match(code, /type: 'task_started'[\s\S]{0,200}type: 'subtask_spawned'/)
    })
    test('§7-3 finalize 第六发射位：budgetStop/budgetNote 两形态过白名单判据才发，审计随 follow 落', () => {
        const code = readCode('services/agent/handler/fanOutFinalizeTask.js')
        assert.match(code, /import \{ budgetDegradedWorthy \} from '\.\.\/\.\.\/core\/session\/taskBudget\.js'/)
        // 发射判据单源：worthy 闸门在，degrade 话在载荷里
        assert.match(code, /budgetDeg && budgetDegradedWorthy\(budgetDeg\)/)
        assert.match(code, /type: 'budget_degraded'[\s\S]{0,200}rootCode, \.\.\.budgetDeg/)
        assert.match(code, /follow\.budgetDegraded = budgetDeg/) // 审计面：事件关也看得见
        // 循环体不许 import 事件件——发射是接线位的职责
        const loop = readCode('services/agent/fanOutFollow.js')
        assert.ok(!/taskEventEmit/.test(loop), 'fanOutFollow import 了事件件——副作用进循环体的红线破了')
        assert.match(loop, /follow\.budgetNote = \{ degrade: 'single-agent', reason: String\(planned\.reason\), allowedSubtasks: 0 \}/)
    })
})

describe('读面与承载（D38 隔离）', () => {
    test('/events：先查 root 定归属、后读事件账（fail-closed 顺序）；401/403/scope-reject 三道门', () => {
        const code = readCode('routes/core/agentTask/root.js')
        const seg = code.slice(code.indexOf("fastify.post('/events'"), code.indexOf("fastify.post('/eventsSubscribe'"))
        const atRoot = seg.indexOf('getByCode(code)')
        const atEvents = seg.indexOf('readTaskEventLog')
        assert.ok(atRoot >= 0 && atEvents > atRoot, '事件账读取早于归属校验=授权旁路')
        assert.ok(/err\.statusCode = 403/.test(seg))
        assert.ok(/scope-reject/.test(seg))
    })
    test('/eventsSubscribe（刀 2）：与 /events 同顺序同契约——归属在前、events/lastId/end/available/reason 五件齐', () => {
        const code = readCode('routes/core/agentTask/root.js')
        const seg = code.slice(code.indexOf("fastify.post('/eventsSubscribe'"))
        assert.ok(seg.length > 500, '订阅端点没接上（找不到段）')
        const atRoot = seg.indexOf('getByCode(code)')
        const atEvents = seg.indexOf('waitTaskEventLog')
        assert.ok(atRoot >= 0 && atEvents > atRoot, '订阅面读事件账早于归属校验=授权旁路')
        assert.ok(/err\.statusCode = 403/.test(seg), '订阅面缺归属 403')
        assert.ok(/scope-reject/.test(seg), '订阅面缺编排形拒绝')
        // 契约同形：消费器一个形状两个面通用（两处各定形必分叉）
        for (const k of ['events', 'lastId', 'end:', 'available', 'reason']) {
            assert.ok(seg.includes(k), `订阅面响应缺 ${k}`)
        }
    })
    test('redisEventClient：独立 db 默认 12、lazyConnect+fail-open（拿不到返回 null 不抛）', () => {
        const code = readCode('daos/cache/redisEventClient.js')
        assert.match(code, /db: Number\.isFinite\(ec\.db\) \? ec\.db : 12/)
        assert.match(code, /lazyConnect: true/)
        assert.match(code, /return null/)
        assert.ok(!/\.xread\(/.test(code), '客户端模块自己不发阻塞读（发它在 taskEventLog 订阅件，且只配专用连接）')
    })
    test('waitTaskEventLog：XREAD BLOCK 只住订阅件、挂起钳位 5s 单源（Traefik/连接数两头）', () => {
        const code = readCode('services/core/session/taskEventLog.js')
        assert.match(code, /xread\('COUNT', n, 'BLOCK', block/)
        assert.match(code, /export const TASK_EVENT_WAIT_MAX_MS = 5000/)
        assert.match(code, /Math\.min\(Number\(waitMs\) \|\| 0, TASK_EVENT_WAIT_MAX_MS\)|Math\.max\(0, Math\.min\(Number\(waitMs\) \|\| 0, TASK_EVENT_WAIT_MAX_MS\)\)/)
        // 段界解析单源：回放与阻塞共用一个函数，两处各写必分叉
        assert.equal((code.match(/function parseEventRows/g) || []).length, 1)
        assert.equal((code.match(/=\s*parseEventRows\(/g) || []).length, 2, '恰好两个调用点（回放+阻塞），第三个就是分叉苗头')
    })
    test('config：taskEvents 默认关、redisEventConfig.db 默认 12（三库分立 cache10/lock11/events12）', async () => {
        const {default: cfg} = await import('../../../conf/system.config.js')
        assert.equal(cfg.agentTask?.taskEvents?.enabled, false)
        assert.equal(cfg.agentTask?.taskEvents?.maxEvents, 500)
        assert.equal(cfg.agentTask?.taskEvents?.ttlSec, 3600)
        assert.equal(cfg.redisEventConfig?.db, 12)
        assert.equal(cfg.redisEventConfig?.host, undefined, '未配 host ⇒ 继承 redisConfig（conf 合成在客户端侧）')
    })
    test('env 严格 true 才开', async () => {
        process.env.agentTask_taskEvents = 'true'
        process.env.redisEventConfig_db = '13'
        const mod = await import(`../../../conf/system.config.js?v=${Math.random()}`)
        delete process.env.agentTask_taskEvents
        delete process.env.redisEventConfig_db
        assert.equal(mod.default.agentTask.taskEvents.enabled, true)
        assert.equal(mod.default.redisEventConfig.db, 13)
    })
})
