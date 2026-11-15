/**
 * @fileOverview sleep-time 整理执行壳的离线用例（假 dac/假模型走真编排函数体）
 * @module test/tasks/sleepTimeConsolidate
 * @description
 * 这一层的"现网"就是这些用例。钉的重点：
 * ①双闸默认值与执行顺序（先校验后抢锁——backfill 同款，但这里连锁都能注入，不留真环境盲区）；
 * ②dry-run 零写零钱（不调模型：模型调用是真金白银，"只出计划"必须连钱都不花）；
 * ③写路径的动作形态与 promote supersede 分支对齐（retired+supersededBy、journal 双行、摘索引），
 *   但**证据事件不降级**（dedupe 合并里被并方不是错误事实——这是两处唯一的刻意分歧）；
 * ④执行层白名单复核（注入坏 kind/幽灵证据的动作必须被编排层拒掉——门不是君子协定）；
 * ⑤消费标记的闭环（进过模型的 episode 都打标，重跑不再选、不再调模型）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'

global.llm = global.llm || {
    logger: {info() {}, warn() {}, error() {}},
    config: {},
    tools: {getUUID() { return 'stub-uuid' }},
}

const mod = await import('../../tasks/sleepTimeConsolidate.js')
const {sleepTimeRunPlan, consolidateNamespace, runSleepTimeConsolidate, toJudgeAtoms} = mod
const cons = await import('../../services/core/memory/consolidator.js')

const NOW = 1763200000000 // 2025-11-15 前后固定值，用例不依赖墙钟
const iso = (ms) => new Date(ms).toISOString()

let uuidSeq = 0
const makeDeps = ({docs = [], namespaces = [], modelActions = [], modelThrows = null} = {}) => {
    const stored = new Map(docs.map(d => [d.atomCode, JSON.parse(JSON.stringify(d))]))
    const calls = {getTop: 0, update: [], add: [], drop: [], journal: [], model: [], acquire: 0, release: 0}
    const atomDac = {
        async getTop(n, opts) {
            calls.getTop++
            if (opts.userCode === 'bad') {
                throw new Error('毒数据 ns：读取即炸')
            }
            let list = [...stored.values()]
            if (opts.userCode) list = list.filter(d => d.userCode === opts.userCode)
            if (opts.channel) list = list.filter(d => d.channel === opts.channel)
            if ('workspaceId' in opts) list = list.filter(d => (d.workspaceId || null) === (opts.workspaceId || null))
            if (opts.state) list = list.filter(d => d.state === opts.state)
            list.sort((a, b) => new Date(a.insertTime) - new Date(b.insertTime))
            return list.slice(0, n).map(d => JSON.parse(JSON.stringify(d)))
        },
        async update(set, cond) {
            calls.update.push({set: JSON.parse(JSON.stringify(set)), cond})
            const doc = stored.get(cond.atomCode)
            if (doc) {
                Object.assign(doc, JSON.parse(JSON.stringify(set)))
            }
            return {modifiedCount: doc ? 1 : 0}
        },
        async add(doc) {
            calls.add.push(JSON.parse(JSON.stringify(doc)))
            stored.set(doc.atomCode, JSON.parse(JSON.stringify(doc)))
            return doc
        },
    }
    const deps = {
        atomDac,
        namespaceDac: {
            async getTop(n, opts, sort) {
                calls.nsGetTop = {n, sort}
                return namespaces.map(d => JSON.parse(JSON.stringify(d)))
            },
        },
        runConsolidation: async ({episodes, existingAtoms}) => {
            calls.model.push({episodes: episodes.map(e => e.atomCode), existingKinds: [...new Set(existingAtoms.map(a => a.kind))]})
            if (modelThrows) {
                throw new Error(modelThrows)
            }
            return {actions: modelActions, model: 'fake-model', attempts: 1}
        },
        dropFromStore: async (atom) => {
            calls.drop.push(atom.atomCode)
            return 1
        },
        journal: async (entry) => {
            calls.journal.push(entry)
        },
        getUUID: () => `gen-${++uuidSeq}`,
        acquireOnce: async () => {
            calls.acquire++
            return true
        },
        releaseLock: async () => {
            calls.release++
        },
    }
    return {deps, calls, stored}
}

const pref = (code, content, over = {}) => ({
    atomCode: code, userCode: 'u1', channel: 'c1', workspaceId: null,
    kind: 'preference', content, confidence: 0.7, insertTime: iso(NOW - 30 * 86400000),
    state: 'active', source: 'auto', evidence: [{eventCode: `ev-${code}`, quote: null}], tags: [], ...over,
})
const ep = (code, daysAgo, over = {}) => ({
    atomCode: code, userCode: 'u1', channel: 'c1', workspaceId: null,
    kind: 'episode', content: `第${code}次对话记录`, confidence: 0.7, insertTime: iso(NOW - daysAgo * 86400000),
    state: 'active', source: 'auto', evidence: [], tags: [], ...over,
})
/** 两条文本相同的 preference + 三条够龄 episode：合并与提炼的触发器都装好 */
const dupSeed = () => [
    pref('p1', '用户偏好中文回复所有邮件', {confidence: 0.6}),
    pref('p2', '用户偏好中文回复所有邮件', {confidence: 0.9}),
    ep('ep1', 10), ep('ep2', 12), ep('ep3', 14),
]

describe('1 sleepTimeRunPlan：默认值就是事故面', () => {
    test('配置全缺 ⇒ dryRun（默认站"不动数据也不动钱包"那一边）', () => {
        const p = sleepTimeRunPlan({})
        assert.equal(p.ok, true)
        assert.equal(p.dryRun, true)
        assert.equal(p.dupSimilarity, 0.92)
        assert.equal(p.idleMs, 3600000)
        assert.deepEqual(
            [p.distill.minEpisodeAgeDays, p.distill.minEpisodes, p.distill.maxPerRun], [7, 3, 20])
    })
    test('sleepTimeWrite 严格 true 才写；字符串 "true" 不算（FASTIFY_CLOSE_GRACE_DELAY 同因）', () => {
        assert.equal(sleepTimeRunPlan({cronConfig: {sleepTimeWrite: true}}).dryRun, false)
        assert.equal(sleepTimeRunPlan({cronConfig: {sleepTimeWrite: 'true'}}).dryRun, true)
        assert.equal(sleepTimeRunPlan({cronConfig: {sleepTimeWrite: true}, overrides: {dryRun: true}}).dryRun, true,
            '人工复查要能强制只看')
    })
    test('安全阀只拦破坏方向：dup<0.8 拒绝；更保守（>1）放行', () => {
        for (const bad of [0.5, 0.79, 0, -1, NaN, 'abc']) {
            const p = sleepTimeRunPlan({overrides: {dupSimilarity: bad}})
            assert.equal(p.ok, false, `dupSimilarity=${bad} 必须被拦`)
            assert.equal(p.dryRun, true, '拦下时不许给出写库许可')
        }
        assert.equal(sleepTimeRunPlan({overrides: {dupSimilarity: 1.5}}).ok, true,
            '1.5 只剩包含合并（保守方向），不拦——阀只管会吃人的那一侧')
    })
    test('配置自相矛盾也是拒绝项：atomCap < minEpisodes = 永远凑不齐门槛的静默空转', () => {
        const p = sleepTimeRunPlan({overrides: {atomCap: 2, minEpisodes: 3}})
        assert.equal(p.ok, false)
        assert.match(p.reason, /静默空转/)
        assert.equal(sleepTimeRunPlan({overrides: {maxNamespaces: 0}}).ok, false)
        assert.equal(sleepTimeRunPlan({overrides: {idleMs: -1}}).ok, false)
    })
})

describe('2 toJudgeAtoms：存储形态→判据视图', () => {
    test('content→text、user_save→pinned、tags→distilledInto、insertTime→数值', () => {
        const [x] = toJudgeAtoms([pref('p', '文本', {source: 'user_save', tags: [{key: 'distilledInto', value: 'gen-1'}]})])
        assert.equal(x.text, '文本')
        assert.equal(x.pinned, true)
        assert.equal(x.distilledInto, 'gen-1')
        assert.equal(x.insertTime, new Date(iso(NOW - 30 * 86400000)).getTime())
    })
})

describe('3 consolidateNamespace dry-run：零写、零钱', () => {
    test('只出计划：一条 update/add 都不发，模型一次都不调', async () => {
        const {deps, calls} = makeDeps({docs: dupSeed()})
        const plan = sleepTimeRunPlan({})
        const r = await consolidateNamespace({ns: {userCode: 'u1', channel: 'c1', workspaceId: null}, plan, now: NOW, deps})
        assert.equal(r.mergesPlanned, 1, '两条同文 preference 应当被判成一对')
        assert.equal(r.mergesApplied, 0)
        assert.equal(r.distillCandidates, 3)
        assert.equal(calls.update.length, 0)
        assert.equal(calls.add.length, 0)
        assert.equal(calls.model.length, 0, 'dry-run 烧钱=设计违规——模型调用必须在 dryRun 分支之外')
        assert.equal(calls.drop.length, 0)
        assert.equal(calls.journal.length, 0)
    })
})

describe('4 consolidateNamespace 写路径：动作形态与白名单', () => {
    const writePlan = (over = {}) => sleepTimeRunPlan({overrides: {dryRun: false, ...over}})
    const modelActions = [
        {action: 'distill', kind: 'preference', text: '用户决定周报使用表格', evidenceAtomCodes: ['ep1', 'ghost']},
        {action: 'distill', kind: 'episode', text: '坏 kind 动作', evidenceAtomCodes: ['ep1']},
        {action: 'distill', kind: 'decision', text: '用户偏好深色主题', evidenceAtomCodes: ['ep2']},
        {action: 'noop', reason: 'all-filtered'},
    ]

    test('合并照抄 supersede 分支形态：retired+supersededBy+摘索引+journal 双行；证据事件不降级', async () => {
        const {deps, calls, stored} = makeDeps({docs: dupSeed(), modelActions: []})
        await consolidateNamespace({ns: {userCode: 'u1', channel: 'c1', workspaceId: null}, plan: writePlan(), now: NOW, deps})
        const away = stored.get('p1')
        assert.equal(away.state, 'retired')
        assert.equal(away.supersededBy, 'p2')
        const keep = stored.get('p2')
        assert.deepEqual(keep.mergedFrom, ['p1'])
        assert.equal(keep.evidence.length, 2, '双方证据并集（ev-p1 + ev-p2）')
        assert.deepEqual(calls.drop, ['p1'])
        const ops = calls.journal.map(j => j.op)
        assert.ok(ops.includes('supersede') && ops.includes('merge'))
        assert.ok(calls.journal.every(j => j.actor === 'system' && /sleep-time/.test(j.reason)),
            'journal 归因方只能来自既有枚举（actor 面没有 consolidator——这就是不发明值的原因）')
        assert.ok(!JSON.stringify(calls.update).includes('"state":"superseded"'),
            '事件降级不该发生：合并掉的偏好不是错误事实')
        assert.ok(!calls.update.some(u => u.cond && Object.keys(u.cond).includes('eventCode')),
            'memoryEvent 面零触碰（promote 的 supersede 会降级事件，这里是刻意的分歧）')
    })

    test('执行层白名单复核：坏 kind 被拒、幽灵证据被滤、产出进 review 态', async () => {
        const {deps, calls} = makeDeps({docs: dupSeed(), modelActions})
        const r = await consolidateNamespace({ns: {userCode: 'u1', channel: 'c1', workspaceId: null}, plan: writePlan(), now: NOW, deps})
        assert.equal(r.distillsInserted, 2, 'episode kind 的动作必须被编排层拒掉——parse 之后再加聪明分支也过不去')
        const kinds = calls.add.map(a => a.kind)
        assert.deepEqual(kinds.sort(), ['decision', 'preference'])
        for (const a of calls.add) {
            assert.equal(a.state, 'review', '模型产出绝不直写生效集（与 supersede 替代者先进待审同款纪律）')
            assert.equal(a.source, 'auto')
            assert.ok(a.evidence.every(e => ['ep1', 'ep2', 'ep3'].includes(e.atomCode)), '证据只认本批候选，ghost 不留')
        }
        const prefDoc = calls.add.find(a => a.kind === 'preference')
        assert.deepEqual(prefDoc.evidence.map(e => e.atomCode), ['ep1'])
    })

    test('消费标记闭环：三条 episode 全打标；重跑不再选、模型不再调', async () => {
        const {deps, calls, stored} = makeDeps({docs: dupSeed(), modelActions})
        await consolidateNamespace({ns: {userCode: 'u1', channel: 'c1', workspaceId: null}, plan: writePlan(), now: NOW, deps})
        for (const code of ['ep1', 'ep2', 'ep3']) {
            const tag = (stored.get(code).tags || []).find(t => t.key === 'distilledInto')
            assert.ok(tag, `${code} 必须带消费标记`)
            assert.ok(tag.value.startsWith('gen-'), '标记值指向提炼产物')
        }
        assert.equal(calls.model.length, 1)
        assert.equal(calls.journal.filter(j => j.op === 'create').length, 2, 'create 的 journal 行数=实际入库数')
        const r2 = await consolidateNamespace({ns: {userCode: 'u1', channel: 'c1', workspaceId: null}, plan: writePlan(), now: NOW, deps})
        assert.equal(r2.distillCandidates, 0, '整理不重复消费——这是 selectDistillCandidates 契约的执行面证明')
        assert.equal(calls.model.length, 1, '第二轮零模型调用（零钱）')
    })

    test('pinned 双侧语义：pinned 在低侧 ⇒ 整对放弃；pinned 在高侧 ⇒ 正常合并', async () => {
        const seed1 = [
            pref('p1', '用户偏好中文回复所有邮件', {confidence: 0.5, source: 'user_save'}),
            pref('p2', '用户偏好中文回复所有邮件', {confidence: 0.9}),
            ep('ep1', 10), ep('ep2', 12), ep('ep3', 14),
        ]
        const a = makeDeps({docs: seed1})
        const ra = await consolidateNamespace({ns: {userCode: 'u1', channel: 'c1', workspaceId: null}, plan: writePlan(), now: NOW, deps: a.deps})
        assert.equal(ra.mergesPlanned, 0, '宁可留重复不碰 pinned')
        const seed2 = seed1.map(d => d.atomCode === 'p1' ? {...d, confidence: 0.9} : {...d, confidence: 0.5})
        const b = makeDeps({docs: seed2})
        const rb = await consolidateNamespace({ns: {userCode: 'u1', channel: 'c1', workspaceId: null}, plan: writePlan(), now: NOW, deps: b.deps})
        assert.equal(rb.mergesApplied, 1)
        assert.equal(b.stored.get('p1').state, 'active')
    })
})

describe('5 runSleepTimeConsolidate：顺序、锁与隔离', () => {
    test('先校验后抢锁：plan 不合法时 acquireOnce 一次都不碰', async () => {
        const {deps, calls} = makeDeps()
        const r = await runSleepTimeConsolidate({deps, dupSimilarity: 0.5})
        assert.equal(r.skipped, 'invalid-plan')
        assert.equal(calls.acquire, 0)
    })
    test('锁占用 ⇒ 跳过且不扫 ns、不释锁（没拿到的锁不许 del）', async () => {
        const {deps, calls} = makeDeps()
        deps.acquireOnce = async () => {
            calls.acquire++
            return false
        }
        const r = await runSleepTimeConsolidate({deps})
        assert.equal(r.skipped, 'lock-held')
        assert.equal(calls.release, 0)
        assert.equal(calls.nsGetTop, undefined)
    })
    test('静默窗口过滤 + 单 ns 失败隔离 + 锁必还', async () => {
        const namespaces = [
            {userCode: 'u1', channel: 'c1', workspaceId: null, lastActiveAt: iso(NOW - 60000)}, // 1 分钟前 ⇒ 在线，跳过
            {userCode: 'bad', channel: 'c1', workspaceId: null, lastActiveAt: iso(NOW - 3 * 3600000)}, // 读取即炸
            {userCode: 'u2', channel: 'c1', workspaceId: null, lastActiveAt: iso(NOW - 2 * 3600000)}, // 静默达标
        ]
        const {deps, calls} = makeDeps({namespaces, docs: dupSeed().map(d => ({...d, userCode: 'u2'}))})
        const r = await runSleepTimeConsolidate({deps, now: NOW})
        assert.equal(r.namespacesScanned, 3)
        assert.equal(r.namespacesIdle, 2, '新鲜 ns 被静默窗口挡下（bad 也在挡后处理之列——它到得了执行）')
        assert.equal(r.failures.length, 1)
        assert.equal(r.perNs.length, 1, '毒数据 ns 不带走整轮，好 ns 照常完成')
        assert.equal(r.perNs[0].ns.startsWith('u2'), true)
        assert.equal(r.dryRun, true, '没开 sleepTimeWrite 时整链只出计划')
        assert.equal(calls.model.length, 0)
        assert.equal(calls.release, 1, '无论中途怎样，锁都还了')
    })
    test('maxNamespaces 传达到 getTop；force 跳锁', async () => {
        const {deps, calls} = makeDeps({namespaces: []})
        await runSleepTimeConsolidate({deps, now: NOW, maxNamespaces: 3, force: true})
        assert.equal(calls.nsGetTop.n, 3)
        assert.equal(calls.acquire, 0, 'force=人工补跑的直通道')
    })
})

describe('6 consolidator 请求体形状（与 extract 隔离但同族纪律）', () => {
    test('thinking 模型关思考、max_tokens/temperature 取 consolidation 节点', () => {
        // 注意：consolidator 在 import 时捕获 `llm.config` 的**对象引用**——改属性可行、换对象无效
        global.llm.config.models = {
            relay_q: {model: 'qwen3-max', apiKey: 'k', baseURL: 'http://127.0.0.1:9'},
            relay_g: {model: 'gpt-x', apiKey: 'k', baseURL: 'http://127.0.0.1:9'},
        }
        global.llm.config.memory = {consolidation: {maxTokens: 777, temperature: 0.4}}
        const b = cons.buildConsolidationBody('relay_q', 'prompt')
        assert.equal(b.enable_thinking, false)
        assert.equal(b.max_tokens, 777)
        assert.equal(b.temperature, 0.4)
        assert.equal(b.stream, false)
        assert.equal(cons.buildConsolidationBody('relay_g', 'p').enable_thinking, undefined, '非思考模型不乱发参数')
    })
})
