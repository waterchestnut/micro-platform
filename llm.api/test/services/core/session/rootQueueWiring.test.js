import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * M1-b 会话任务队列在 `root.js` 的**接线**不变量（判据本身在 turnScheduler/taskQueueComposer 各自用例里）。
 *
 * 为什么单列：判据全绿但没在 overlap 分支正确接线，用户行为一个字都不变——或更糟：
 * 接错成"投 queue 自动派发"就在上一轮还活着时并发跑同会话（正是 runOverlap 要防的竞态）。
 * 这些是"看着能跑其实跑错"的地方，必须用源码位置钉住，不能只靠点击。
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
function linesOf(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '').split('\n')
}
function codeOnly(ls) {
    return ls.filter((l) => !/^\s*(\*|\/\/)/.test(l.trim()))
}

describe('root.js：overlap-reject 分支按开关分叉为"入队 queued"', () => {
    const code = codeOnly(linesOf('routes/core/chat/root.js'))
    const idx = (re) => code.findIndex((l) => re.test(l))
    const fork = idx(/if \(!od\.admit\) \{/)

    test('静态导入两个纯判据件（判据/组装不重造，root 只接线）', () => {
        assert.ok(code.some((l) => /^import .*decideQueueOnOverlap.*from '.*turnScheduler\.js'/.test(l)), '没静态导入 decideQueueOnOverlap')
        assert.ok(code.some((l) => /^import .*buildSerializedTurnTask.*from '.*taskQueueComposer\.js'/.test(l)), '没静态导入 buildSerializedTurnTask')
    })

    test('重模块(addAgentTask)只走动态 import，且**不在**顶层 import——否则默认热路径被拖进 kafka/redlock', () => {
        assert.ok(
            !code.some((l) => /^import .*\baddAgentTask\b.*from '.*services\/core\/agentTask\.js'/.test(l)),
            'addAgentTask 不该被顶层静态 import 拖进默认热路径（本文件对 globalRunGate/redisClient 同规）',
        )
        assert.ok(code.some((l) => /await import\('[^']*services\/core\/agentTask\.js'\)/.test(l)), '开关分支里没有动态 import addAgentTask')
    })

    test('分叉在 overlap 分支内、且排在建 SSE 通道之前（与并发闸同层，才能用 HTTP 体而非流帧表达 queued）', () => {
        const ctrl = idx(/new AbortController\(/)
        assert.ok(fork >= 0, '找不到 !od.admit 分支（结构变了要重写本用例，别跳过）')
        assert.ok(ctrl >= 0, '找不到 AbortController 锚点')
        const q = idx(/decideQueueOnOverlap\(/)
        assert.ok(q > fork && q < ctrl, `入队判定应在 !od.admit 之后、建通道之前：fork=${fork + 1} q=${q + 1} ctrl=${ctrl + 1}`)
    })

    test('分叉受总开关 conversationTaskQueue.enabled===true 严格闸（缺省关=现网逐字不变）', () => {
        assert.ok(code.some((l) => /qCfg\.enabled === true/.test(l)), '没有 enabled===true 的真值闸')
        // 关时不该走到 buildSerializedTurnTask：确认它位于 enabled 闸之后
        const gate = idx(/qCfg\.enabled === true/)
        const build = idx(/buildSerializedTurnTask\(/)
        assert.ok(build > gate, 'buildSerializedTurnTask 不在 enabled 闸之内')
    })

    test('入队执行体是 turnRunner（忠实重放），不是 memory-off 的 agentChat', () => {
        assert.ok(code.some((l) => /handler:\s*'turnRunner'/.test(l)), 'serialized-turn 执行体没写 turnRunner')
        assert.ok(!code.some((l) => /handler:\s*'agentChat'/.test(l)), '绝不该把排队追问路由到 agentChat（memory:off，语义不符）')
    })

    test('判定用 overlapAdmit:false（只在"本已判拒"时排队，不重造陈旧判定）', () => {
        const seg = code.slice(fork, fork + 40).join('\n')
        assert.match(seg, /overlapAdmit:\s*false/, 'decideQueueOnOverlap 没显式声明这是 would-reject 情形')
    })

    test('成功入队返回 200 + success:true + data.queued（受理非错误）；入队异常/队列满落回现网 rejectResponse', () => {
        const seg = code.slice(fork, fork + 80).join('\n')
        assert.match(seg, /data:\s*\{queued:\s*true/, 'queued 成功体缺失')
        assert.match(seg, /await addAgentTask\(turn\)/, '没调用 addAgentTask 落库')
        // 现网拒绝体仍在，作为默认与兜底出口（须是 overlap 分支里那处，不是并发闸更早的同形返回）
        const reject = code.findIndex((l, i) => i > fork && /return reply\.code\(r\.httpStatus\)\.send\(r\.body\)/.test(l))
        assert.ok(reject > fork, 'rejectResponse 出口不在 !od.admit 分支里（默认路径可能被破坏）')
    })
})

describe('root.js：第二入口 stale-open-run（开闸测验实锤：长任务追问该排队不该并发）', () => {
    const code = codeOnly(linesOf('routes/core/chat/root.js'))
    const idx = (re) => code.findIndex((l) => re.test(l))

    test('静态导入 decideQueueOnStaleOpenRun 且接线在 qCfg 闸内', () => {
        assert.ok(code.some((l) => /^import .*decideQueueOnStaleOpenRun.*from '.*turnScheduler\.js'/.test(l)), '没静态导入第二入口判据')
        const gate = idx(/qCfg\.enabled === true && \(!od\.admit \|\| od\.reason === 'stale-open-run'\)/)
        assert.ok(gate >= 0, '外层闸没有 stale-open-run 分支（普通消息不该付 count 查询的钱，两个入口都必须在闸里）')
        const call = idx(/decideQueueOnStaleOpenRun\(\{/)
        assert.ok(call > gate, '第二入口判定调用不在外层闸之后')
    })

    test('心跳取自 prevOpen.updateTime，staleMs 用 qCfg.staleMs 单源（不另造阈值）', () => {
        assert.ok(code.some((l) => /prevOpen\?\.updateTime/.test(l)), '心跳没从 findOpenRun 行取（投影缺 updateTime 时这里会恒 unknown——守卫另有断言）')
        const seg = code.slice(idx(/decideQueueOnStaleOpenRun\(\{/), idx(/decideQueueOnStaleOpenRun\(\{/) + 4).join('\n')
        assert.match(seg, /staleMs:\s*qCfg\.staleMs/, 'staleMs 不是单源透传')
        assert.match(seg, /prevHeartbeatAgeMs:\s*hbAge/, '心跳年龄没传进判据')
    })

    test('入口来源进日志（queue 日志带 入口=，两条入口的病因要分得开）', () => {
        assert.ok(code.some((l) => /入口=\$\{od\.admit \? 'stale-open-run' : 'overlap-reject'\}/.test(l)), '入队日志缺入口标记')
    })
})

describe('config：conversationTaskQueue 默认关、env 可开、键齐', () => {
    test('默认 enabled=false，且 staleMs/maxQueue 有默认值', async () => {
        const {default: cfg} = await import('../../../../conf/system.config.js')
        const q = cfg.limits?.conversationTaskQueue
        assert.ok(q, '配置缺 limits.conversationTaskQueue')
        assert.equal(q.enabled, false, '默认必须关（关时与现网逐字一致是本刀的地基）')
        assert.equal(q.staleMs, 45000)
        assert.equal(q.maxQueue, 50)
    })

    test('env limits_conversationTaskQueue=true 才能打开；未设/其它值都算关', async () => {
        const load = async (env) => {
            Object.entries(env).forEach(([k, v]) => { process.env[k] = v })
            const mod = await import(`../../../../conf/system.config.js?v=${Math.random()}`)
            delete process.env.limits_conversationTaskQueue
            return mod.default.limits.conversationTaskQueue.enabled
        }
        assert.equal(await load({limits_conversationTaskQueue: 'true'}), true)
        assert.equal(await load({limits_conversationTaskQueue: '1'}), false, '必须严格 ===true，别让 "1"/"yes" 误开热路径')
        assert.equal(await load({}), false)
    })

    test('pump 的 cron 键都声明（retention.js 会读，缺则运维只能读代码）', async () => {
        const {default: cfg} = await import('../../../../conf/system.config.js')
        for (const k of ['pumpEnabled', 'pumpPattern', 'pumpBatch', 'pumpLockTtlSeconds']) {
            assert.ok(k in (cfg.cron || {}), `cron 缺 ${k}`)
        }
    })
})
