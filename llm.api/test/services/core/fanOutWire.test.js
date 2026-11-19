import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * C/B1 finalize 触发的**接线**不变量（判据本身在 parentAggregate.test.js 的 20 路基线里）。
 * 这里钉的是"焊在正确的位置"：锁内只设标志、派发必在 finally 之后——持锁调模型是拖炸建课等
 * 全部现网 fan-out 的事故形状（handoff/§9 接入发现），绝不能靠 review 肉眼守。
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
function linesOf(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '').split('\n')
}
function codeOnly(ls) {
    return ls.filter((l) => !/^\s*(\*|\/\/)/.test(l.trim()))
}

describe('agentTask.js：finalize 触发锁内/锁外的位置纪律', () => {
    const code = codeOnly(linesOf('services/core/agentTask.js'))
    const fnStart = code.findIndex((l) => /export async function updateParentAgentTaskWithLock/.test(l))
    const fnEnd = code.findIndex((l, i) => i > fnStart && /^async function dispatchFanOutFinalize/.test(l))
    const body = code.slice(fnStart, fnEnd)
    const idx = (re) => body.findIndex((l) => re.test(l))

    test('shouldTriggerFinalize 的调用在 finally(释放锁) 之前（锁内只设标志）', () => {
        const trig = idx(/shouldTriggerFinalize\(/)
        const fin = idx(/^\s*\} finally \{/)
        assert.ok(trig >= 0, 'updateParent 里找不到 finalize 触发判定')
        assert.ok(fin > trig, `触发判定应在锁内（finally 之前）：trig=${trig} fin=${fin}`)
    })

    test('finalize 的派发调用在 finally 之后（锁外），且只吃锁内捕获的 finalizeRoot 快照', () => {
        const fin = idx(/^\s*\} finally \{/)
        const disp = idx(/await dispatchFanOutFinalize\(finalizeRoot/)
        assert.ok(disp > fin, `派发必须在 finally 之后：disp=${disp} fin=${fin}`)
        assert.ok(idx(/finalizeRoot = parentAgentTask/) >= 0 && idx(/finalizeRoot = parentAgentTask/) < fin,
            'finalizeRoot 只能在锁内捕获')
    })

    test('direct 派发必须动态 import execAgentTask；顶层绝不静态引 agent/index（core→agent→core 静态环+启动读 llm 会炸）', () => {
        assert.ok(!code.some((l) => /^import .*from '.*services\/agent\/index\.js'/.test(l)),
            'agent/index.js 被顶层静态 import——循环依赖回归')
        const dispStart = code.findIndex((l) => /^async function dispatchFanOutFinalize/.test(l))
        const dispBody = code.slice(dispStart, dispStart + 40).join('\n')
        assert.match(dispBody, /await import\('\.\.\/agent\/index\.js'\)/, 'direct 模式没有动态 import')
        assert.match(dispBody, /kafkaConfig\.topics\.agentTask\.topic/, 'kafka 模式没走既有 topic 派发')
    })

    test('配置读取在调用时（config.agentTask?.fanOutOrchestration）——支持运维/env 生效，探针也能按阶段翻转验证', () => {
        assert.ok(code.some((l) => /config\.agentTask\?\.fanOutOrchestration/.test(l)), 'finalize 判定没读调用时配置')
    })
})

describe('config 与 schema：默认关 + 双闸', () => {
    test('agentTask.fanOutOrchestration 默认 enabled=false、dispatch=kafka；env 必须显式 true 才开', async () => {
        const {default: cfg} = await import('../../../conf/system.config.js')
        const f = cfg.agentTask?.fanOutOrchestration
        assert.ok(f, '配置缺 agentTask.fanOutOrchestration')
        assert.equal(f.enabled, false, '默认必须关（B0 基线+现网逐字不变的地基）')
        assert.equal(f.dispatch, 'kafka')
    })

    test('M4b：fanOutPlanner 默认关，且超时/重试有短默认（planner 卡住=拖垮交互）', async () => {
        const {default: cfg} = await import('../../../conf/system.config.js')
        const p = cfg.agentTask?.fanOutPlanner
        assert.ok(p, '配置缺 agentTask.fanOutPlanner')
        assert.equal(p.enabled, false, '默认必须关（关时连模型都不碰）')
        assert.ok(p.timeoutMs > 0 && p.timeoutMs <= 60000, `planner timeoutMs 必须短,实际 ${p.timeoutMs}`)
        assert.ok(p.maxRetries >= 0 && p.maxRetries <= 2, `maxRetries 必须小,实际 ${p.maxRetries}`)
    })

    test('M4b：planner 服务只允许**动态**引且必在入口判定之内（默认路径不加载重模块、不付模型往返）', () => {
        const rootSrc = linesOf('routes/core/chat/root.js').join('\n')
        assert.ok(!/^import .*fanOutPlannerService/m.test(rootSrc),
            'planner 服务被顶层静态 import——它会经 core/agentTask 拖进 redlock/kafka，绝不许进默认热路径')
        assert.ok(/if \(fanOutEntryDecision\.attempt\) \{[\s\S]{0,400}await import\('[^']*fanOutPlannerService\.js'\)/.test(rootSrc),
            '动态 import 必须包在入口判定之内（判定不过就不该碰 planner 模块）')
        assert.ok(/decideFanOutEntry\(/.test(rootSrc), '路由没走入口判据纯件（判据不许在路由里手写一遍）')
        /** 不扇出必须"落回普通回答"：两处出口都要在，且不能出现 throw/拒绝码（功能没开不是用户的错） */
        assert.match(rootSrc, /任务模式未成行\(落回普通回答\)/)
        assert.match(rootSrc, /任务模式规划异常\(落回普通回答\)/)
        assert.ok(!/taskAccepted[\s\S]{0,200}(statusCode\s*=\s*4|reply\.code\(4)/.test(rootSrc),
            '任务模式失败不许回 4xx——漏判必须无损退化成普通回答')
        // grpc 侧不属本次拍板的入口面：它若引用 planner 就是第二个自动入口，须另议
        const grpcSrc = linesOf('grpc/servers/agentController.js').join('\n')
        assert.ok(!/fanOutPlannerService|planFanOutFromRequest/.test(grpcSrc),
            'agentController 引用了 planner——入口只批了 /stream 的显式形态，别处再加要先过评审')
    })

    test('M4b：options.taskMode 是 schema **声明**字段（不许靠 auditBody 的未声明通道混过去）', async () => {
        const {chatStreamBodySchema} = await import('../../../schemas/chatStreamSchema.js')
        const tm = chatStreamBodySchema.properties.options.properties.taskMode
        assert.ok(tm, 'taskMode 未声明')
        assert.ok(JSON.stringify(tm.type).includes('boolean'), 'taskMode 类型应含 boolean')
    })

    test('M4b：service 必须把**解析后的** mode 传给 buildRootTask（e2e 抓到写 `{handleMode}` 入参 undefined 被 schema 默认成 queue ⇒ 误投 Kafka）', () => {
        const svc = linesOf('services/agent/fanOutPlannerService.js').join('\n')
        assert.match(svc, /extra:\s*\{\s*handleMode:\s*mode,/, 'resolved mode 没有真的传下去')
        assert.ok(!/extra:\s*\{\s*handleMode\s*,/.test(svc), '不许用 {handleMode} 简写——入参可能是 undefined，会盖出意外默认值')
    })

    test('agentTaskSchema 声明 orchestrated（不声明会被 bulkWrite 静默丢，serialized-turn 同款教训）', () => {
        const s = linesOf('daos/core/schema/agentTaskSchema.js').join('\n')
        assert.match(s, /orchestrated:\s*\{type:\s*Boolean/)
    })

    test('§5-1 幂等双闸齐备：schema 两道 partial-unique + 应用层先查后插 + E11000 竞态回查（缺一即并发裸奔）', () => {
        const schema = linesOf('daos/core/schema/agentTaskSchema.js').join('\n')
        assert.match(schema, /unique:\s*true,[\s\S]*?partialFilterExpression:\s*\{agentRole:\s*'serialized-turn',\s*handleStatus:\s*0\}/,
            'serialized-turn 缺 partial-unique（同码并发双行）')
        assert.match(schema, /unique:\s*true,[\s\S]*?partialFilterExpression:\s*\{agentRole:\s*'root',\s*orchestrated:\s*true\}/,
            '编排 root 缺 partial-unique（同 taskCode 并发双树）')
        const root = linesOf('routes/core/chat/root.js').join('\n')
        // M5 重构后的合流形状：幂等预查/竞态回查住进共享入队体 enqueueSerializedTurn，
        // 四个入口（overlap-reject/stale-open-run/gate-local-full/gate-global-full）都够到同一份——
        // 锚跟着搬家，一条没减（断"预查在入队之前"仍靠 pickIdempotentHit 先于 addAgentTask 的体内顺序）。
        assert.match(root, /const enqueueSerializedTurn = async[\s\S]*?pickIdempotentHit\(\{[\s\S]*?await addAgentTask\(turn\)/,
            '共享入队体没有幂等预查（或预查跑在落库之后=窗口颠倒）')
        assert.match(root, /isDuplicateKeyError\(e\)[\s\S]{0,600}hit2/, '入队体没有 E11000 竞态回查')
        assert.ok(!/idempotent:\s*true[\s\S]{0,200}statusCode\s*=\s*4/.test(root), '幂等命中不许回 4xx（重复请求=同一受理，不是错误）')
        const svc = linesOf('services/agent/fanOutPlannerService.js').join('\n')
        assert.match(svc, /if \(idemKey\) \{[\s\S]{0,300}findRootByKey/, 'service 缺 planner 前的幂等预查（重发要白烧一次模型）')
        assert.match(svc, /root\.params = \{ \.\.\.root\.params, idemKey \}/, 'idemKey 没写进 root.params（索引没有可约束的键）')
    })

    test('§5-1 chatStreamSchema 声明 taskCode（客户端幂等键走声明字段，不走 auditBody 未声明通道）', async () => {
        const {chatStreamBodySchema} = await import('../../../schemas/chatStreamSchema.js')
        const tc = chatStreamBodySchema.properties.options.properties.taskCode
        assert.ok(tc, 'taskCode 未声明')
        assert.ok(tc.maxLength > 0 && tc.pattern, 'taskCode 必须有长度与字符约束（会被拼进 filter/索引键）')
    })

    test('追活(f)：retryCount 与 replanCount 成对声明——finalize 写回两个都写，漏一个是静默丢半边计数', () => {
        const s = linesOf('daos/core/schema/agentTaskSchema.js').join('\n')
        for (const f of ['retryCount', 'replanCount']) {
            assert.ok(new RegExp(`^\\s*${f}:`, 'm').test(s), `schema 缺 ${f} 声明`)
        }
    })
})
