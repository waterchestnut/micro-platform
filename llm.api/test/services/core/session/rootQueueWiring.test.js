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

    test('分叉受总开关 conversationTaskQueue.enabled===true 严格闸（缺省关=现网逐字不变；M5 重构后住共享体）', () => {
        assert.ok(code.some((l) => /qCfg\.enabled === true/.test(l)), '没有 enabled===true 的真值闸')
        // M5 后 buildSerializedTurnTask 住进共享体 enqueueSerializedTurn——"闸在后"改为钉两处入口：
        // overlap 外层闸 + queueOnCapacityGate 首行的 enabled 短路，共享体本体只被这两处够到。
        const enq = idx(/const queueOnCapacityGate = async/)
        assert.ok(enq >= 0, '找不到并发闸分叉主体 queueOnCapacityGate')
        assert.match(code.slice(enq, enq + 4).join('\n'), /qCfg\.enabled !== true[^\n]*return null/,
            'queueOnCapacityGate 首行没有 enabled!==true 短路——开关关也必须逐字走原拒绝体')
        const gate = idx(/qCfg\.enabled === true && \(!od\.admit \|\| od\.reason === 'stale-open-run'\)/)
        const call = idx(/const sent = await enqueueSerializedTurn\(\{/)
        assert.ok(gate >= 0 && call > gate, 'overlap 的入队调用不在 enabled 闸之后')
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
        // M5 重构：入队体从 overlap 分支抽出为共享函数（四入口一体），锚跟着搬——
        // 判据不变：queued 成功体、addAgentTask 落库、失败返回 null 落回调用方原拒绝路径。
        const def = idx(/const enqueueSerializedTurn = async/)
        assert.ok(def >= 0, '找不到共享入队体 enqueueSerializedTurn')
        const body = code.slice(def, def + 90).join('\n')
        assert.match(body, /data:\s*\{queued:\s*true/, 'queued 成功体缺失')
        assert.match(body, /await addAgentTask\(turn\)/, '没调用 addAgentTask 落库')
        assert.match(body, /return null/, '入队失败必须返回 null 落回拒绝（绝不谎称已排队）')
        // overlap 调用点：sent 才 return；未 sent 继续走到 rejectResponse 原出口（默认与兜底同一行）
        const callSeg = code.slice(fork, fork + 60).join('\n')
        assert.match(callSeg, /const sent = await enqueueSerializedTurn\(\{/, 'overlap 分支没调用共享入队体')
        assert.match(callSeg, /if \(sent\) \{[\s\S]{0,120}releaseGateSlots\(\)[\s\S]{0,60}return sent/, '入队成功没有归还闸位就直接返回（漏一格=慢毒）')
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

    test('入口来源进日志（queue 日志带 入口=，各入口的病因要分得开；M5 后住共享体）', () => {
        assert.ok(code.some((l) => /入口=\$\{entryLabel\}/.test(l)), '入队日志缺入口标记')
        // 四个 label 值一个不能少：两条 overlap 入口 + M5 两条容量闸入口
        for (const label of ['overlap-reject', 'stale-open-run', 'gate-local-full', 'gate-global-full']) {
            assert.ok(code.some((l) => l.includes(`'${label}'`)), `入口 label 缺失: '${label}'`)
        }
    })
})

/**
 * M5（容量闸排队分叉，属主拍板① 2026-11-19）：并发闸（局部 admitRun / 全局 admitGlobal）满时
 * 不再直接 4290——conversationTaskQueue 开着就走 taskAdmission 四档判据，队列塞得下就 queued。
 * 这些位置判据全绿也≠接对了：接错顺序（先拒后排/闸关仍排队）都是用户可见事故，源码位钉死。
 */
describe('root.js：并发闸满排队分叉（M5）', () => {
    const code = codeOnly(linesOf('routes/core/chat/root.js'))
    const idx = (re) => code.findIndex((l) => re.test(l))

    test('两个拒绝点都在回 4290 之前先问排队（局部分叉在 response 发送前；全局分叉在归还局部位之后）', () => {
        const localFork = idx(/queueOnCapacityGate\(gated\.decision, 'gate-local-full'\)/)
        const localSend = idx(/const r = gated\.response/)
        assert.ok(localFork >= 0 && localSend > localFork, '局部闸：排队分叉没排在 4290 拒绝体之前')
        const rel = idx(/releaseRun\(messageCodeForGate\)/)
        const globalFork = idx(/queueOnCapacityGate\(g\.decision, 'gate-global-full'\)/)
        const globalSend = idx(/const r = g\.response/)
        assert.ok(globalFork >= 0 && rel >= 0 && rel < globalFork && globalSend > globalFork,
            '全局闸：必须先是 releaseRun 归还局部位、再问排队、最后才回 4290（顺序错了=全局拒绝永久吃掉一格本地额度）')
    })

    test('档位词表单源映射：global-full→global 档、user-full→user 档，认不得的理由一律回原拒绝体', () => {
        const def = idx(/const queueOnCapacityGate = async/)
        const body = code.slice(def, def + 30).join('\n')
        assert.match(body, /'user-full'[\s\S]{0,80}userActive: decision\.active/, 'user-full 没映射到 user 档')
        assert.match(body, /'global-full'[\s\S]{0,80}globalActive: decision\.active/, 'global-full 没映射到 global 档')
        assert.match(body, /if \(!tier\) return null/, '未知拒绝理由没有回落到原拒绝体（分叉不许吞下不认识的闸）')
    })

    test('容量判据走 taskAdmission 单源（四档比较不在路由重写一遍）', () => {
        assert.ok(code.some((l) => /^import \{decideTaskAdmission, rejectQueueFull\}.*taskAdmission\.js/.test(l)), '没静态导入 decideTaskAdmission')
        const seg = code.slice(idx(/const queueOnCapacityGate = async/), idx(/const queueOnCapacityGate = async/) + 30).join('\n')
        assert.match(seg, /decideTaskAdmission\(\{/, '分叉没有调用四档判据单源')
        assert.ok(!/maxQueue[^\n]*&&[^\n]*queueCount\s*>=/.test(seg), '路由里手写了队列满比较=第二套真相')
    })

    test('turnRunner 出场占闸（排队绕过 HTTP 闸 ≠ 绕过容量；闸关连模块都不加载）', () => {
        const tr = codeOnly(linesOf('services/agent/handler/turnRunner.js')).join('\n')
        assert.match(tr, /gateCfg\.global\?\.enabled === true/, '没有显式 true 闸')
        assert.match(tr, /await import\('[^']*globalRunGate\.js'\)/, '闸模块不是动态 import（默认关也必须零加载）')
        assert.match(tr, /G\.admitGlobal\(\{store, messageCode, userCode/, '出场前没有占全局位')
        assert.match(tr, /finally[\s\S]{0,400}releaseGlobal/, 'release 不在 finally（execChat 抛错也要归还）')
        assert.match(tr, /handleStatus: 0, handleRet: agentTaskInfo\.handleRet/, '槽满返回形状：留等待(0)且回带原 handleRet（写回 null=抹掉入队载荷）')
        assert.ok(!/handleStatus: -1[\s\S]{0,120}槽满|槽满[\s\S]{0,120}handleStatus: -1/.test(tr), '槽满被当成失败=丢单，绝不允许')
    })

    test('泄漏位归还（M5 复查抓出的既有 bug 钉死）：overlap 区三个提前 return 前必须成对归还闸位', () => {
        // admitRun 占位发生在 SSE try(:749) 之前；排队/队列满/4291 三个提前 return 都走不到
        // finally(:823)——不归还=每次 overlap 排队/拒绝永久吃掉一格局部位（全局位开了同样漏）。
        const helper = idx(/const releaseGateSlots = \(\) => \{/)
        assert.ok(helper >= 0, '找不到成对归还 helper')
        const helperBody = code.slice(helper, helper + 8).join('\n')
        assert.match(helperBody, /releaseRun\(messageCodeForGate\)/, 'helper 没还局部位')
        assert.match(helperBody, /globalGate[\s\S]{0,80}releaseGlobal/, 'helper 没还已占有的全局位')
        const enq = idx(/const sent = await enqueueSerializedTurn\(\{/)
        assert.ok(enq >= 0 && code.slice(enq, enq + 9).join('\n').includes('releaseGateSlots()'), 'queued 归还点丢失')
        const qf = idx(/const sent = rejectQueueFullReply/)
        assert.ok(qf >= 0 && code.slice(qf, qf + 5).join('\n').includes('releaseGateSlots()'), '4292 归还点丢失')
        const rejectOut = idx(/拒绝出口同样在 SSE try 之前/)
        assert.ok(rejectOut >= 0 && code.slice(rejectOut, rejectOut + 3).join('\n').includes('releaseGateSlots()'), '4291 归还点丢失')
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
