/**
 * @fileOverview 全局并发闸的用例（PR-0.4 剩余项）
 * @module test/services/core/session/globalRunGate
 * @description
 * 分工要先说白：**Lua 脚本本身的原子性/返回值**只有真 redis 能证明（随刀的 live 探针做过，§25 记录）；
 * 本文件测的是 JS 侧一切可离线证伪的东西：开关矩阵、结果解析（含"未知结果必须走 fail-open 而不是误拒"）、
 * store 适配器的命令与参数形状（hash-tag/剪枝线/TTL）、失败语义，以及 root.js 的接线锚
 * （尤其"全局拒必须归还局部位"与"finally 成对释放"——这两条错了就是永久漏位）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/session/globalRunGate.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const G = await import(pathToFileURL(path.join(SRC, 'services/core/session/globalRunGate.js')).href)
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('1 开关矩阵（默认关是纪律）', () => {
    test('global 未配 / false / limit=0 都不开；limit>0 且 enabled=true 才开', () => {
        assert.equal(G.globalGateEnabled({}), false)
        assert.equal(G.globalGateEnabled({limit: 8, global: {}}), false)
        assert.equal(G.globalGateEnabled({limit: 8, global: {enabled: 'true'}}), false, '字符串 true 不算——配置读取侧就该是布尔')
        assert.equal(G.globalGateEnabled({limit: 0, global: {enabled: true}}), false, '局部闸关着时全局闸无从叠加')
        assert.equal(G.globalGateEnabled({limit: 8, global: {enabled: true}}), true)
    })
})

describe('2 parseAdmissionResult：三种返回 + 未知形态', () => {
    test('0 ⇒ admit（带占位后计数）', () => {
        const d = G.parseAdmissionResult([0, 5], {limit: 8})
        assert.equal(d.admit, true)
        assert.equal(d.active, 5)
        assert.equal(d.code, 0)
    })
    test('-1/-2 ⇒ 4290 拒绝，reason 各是各的（客户端要靠它区分"服务忙"和"你太快"）', () => {
        const g = G.parseAdmissionResult([-1, 8], {limit: 8, retryAfterMs: 2000})
        assert.equal(g.admit, false)
        assert.equal(g.reason, 'global-full')
        assert.equal(g.code, 4290)
        assert.equal(g.retryAfterMs, 2000)
        const u = G.parseAdmissionResult([-2, 3], {limit: 8, perUserLimit: 3})
        assert.equal(u.reason, 'user-full')
    })
    test('未知返回抛错（让 admitGlobal 走 fail-open）——"没读懂"冒充"满了"会误拒全站', () => {
        assert.throws(() => G.parseAdmissionResult('ERR wrongkey', {limit: 8}), /未知结果/)
        assert.throws(() => G.parseAdmissionResult([7, 1], {limit: 8}), /未知结果/)
    })
})

describe('3 createRedisStore：命令与参数形状', () => {
    function fakeRedis() {
        const calls = []
        return {calls, client: {
            eval: async (lua, numKeys, ...args) => { calls.push({op: 'eval', lua, numKeys, args}); return [0, 1] },
            zrem: async (key, member) => { calls.push({op: 'zrem', key, member}); return 1 },
            zcard: async (key) => { calls.push({op: 'zcard', key}); return 2 },
        }}
    }
    test('EVAL：2 键都带同一 hash-tag（cluster 同槽硬要求），参数全字符串，剪枝线=now-maxAge', async () => {
        const {calls, client} = fakeRedis()
        const store = G.createRedisStore(client, {limit: 8, perUserLimit: 3, global: {maxRunAgeMs: 60000}})
        await store.admit({messageCode: 'm-1', userCode: 'u-9', now: 1000000})
        const c = calls[0]
        assert.equal(c.numKeys, 2)
        assert.ok(c.args[0].includes('{llm-runz}') && c.args[1].includes('{llm-runz}'), `两键必须共享 hash-tag: ${c.args[0]} ${c.args[1]}`)
        assert.ok(c.args[1].startsWith('{llm-runz}:u:'), '用户键要区分开')
        assert.equal(c.args[2], 'm-1')
        assert.ok(c.args.slice(2).every((x) => typeof x === 'string'), 'redis 参数必须全字符串')
        assert.equal(c.args[4], String(1000000 - 60000), 'staleBefore=now-maxRunAge')
        assert.equal(c.args[5], '8')
        assert.equal(c.args[6], '3')
        assert.equal(c.args[7], String(60 + 300), 'TTL=死账线+5分钟兜底')
    })
    test('release：全局键与用户键都 ZREM（漏一个=该用户永久占全局一格）', async () => {
        const {calls, client} = fakeRedis()
        const store = G.createRedisStore(client, {limit: 8, global: {}})
        await store.release({messageCode: 'm-2', userCode: 'u-9'})
        const rems = calls.filter((x) => x.op === 'zrem')
        assert.equal(rems.length, 2)
        assert.ok(rems.every((x) => x.member === 'm-2'))
        assert.notEqual(rems[0].key, rems[1].key)
    })
})

describe('4 admitGlobal/releaseGlobal：fail-open 与吞错', () => {
    const noisy = {warn: [], info: []}
    test('store 抛 ⇒ admit:true + degraded + reason=store-unavailable（"数不了"不许变成"都不许用"）', async () => {
        const r = await G.admitGlobal({store: {admit: async () => { throw new Error('redis down') }}, messageCode: 'm', userCode: 'u', cfg: {limit: 8}, logger: {warn: (x) => noisy.warn.push(x)}})
        assert.equal(r.admit, true)
        assert.equal(r.degraded, true)
        assert.equal(r.decision.reason, 'store-unavailable')
        assert.ok(noisy.warn.length === 1, '必须留 warn 痕')
    })
    test('拒绝 ⇒ 带 rejectResponse 形态（200 + success:false + 4290 三件套是 v1.30 实测的结论）', async () => {
        const r = await G.admitGlobal({store: {admit: async () => [-1, 9]}, messageCode: 'm', userCode: 'u', cfg: {limit: 8}})
        assert.equal(r.admit, false)
        assert.equal(r.response.httpStatus, 200)
        assert.equal(r.response.body.success, false)
        assert.equal(r.response.body.code, 4290)
    })
    test('release 失败 ⇒ false + warn，不抛（清理失败不能让收尾炸）', async () => {
        const warns = []
        const ok = await G.releaseGlobal({store: {release: async () => { throw new Error('gone') }}, logger: {warn: (x) => warns.push(x)}})
        assert.equal(ok, false)
        assert.equal(warns.length, 1)
    })
})

describe('5 Lua 结构断言（顺序错了真 redis 不报错、只悄悄失效）', () => {
    test('剪枝在计数前；两个检查都在 ZADD 前；EXPIRE 兜底在位', () => {
        const lua = G.ADMISSION_LUA
        const prune = lua.indexOf('ZREMRANGEBYSCORE')
        const card = lua.indexOf('ZCARD')
        const add = lua.indexOf('ZADD')
        assert.ok(prune >= 0 && prune < card, '必须先清死账再数')
        assert.ok(card < add, '必须先数再占')
        assert.ok(lua.indexOf('-2') < add, 'user 检查也要在占位前')
        assert.ok(lua.includes('EXPIRE'), 'TTL 兜底')
        assert.ok((lua.match(/ZREMRANGEBYSCORE/g) || []).length === 2, '两把键都要剪')
        assert.ok((lua.match(/ZADD/g) || []).length === 2, '两把键都要占')
    })
})

describe('6 root.js 接线锚', () => {
    const codeOf = (rel) => strip(fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, ''))
    const root = () => codeOf('routes/core/chat/root.js')
    test('全局块在 limit>0 之内、enabled 判定在前；被全局拒先 releaseRun 再回 4290', () => {
        const r = root()
        assert.match(r, /if \(gateCfg\.global\?\.enabled === true\) \{[\s\S]*?createRedisStore[\s\S]*?admitGlobal/)
        assert.match(r, /if \(!g\.admit\) \{\s*\n\s*releaseRun\(messageCodeForGate\)/, '全局拒不还局部位=永久漏一格')
    })
    test('finally 成对释放（globalGate 句柄存在才释放——没占过位的人不许去 ZREM 别人的）', () => {
        assert.match(root(), /if \(globalGate\) \{\s*\n\s*await globalGate\.mod\.releaseGlobal\(\{/)
    })
})
