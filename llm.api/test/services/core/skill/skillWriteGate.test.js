/**
 * @fileOverview skill 写面幂等闸接线层的行为用例（deps 注入假账，真跑每一支）
 * @module test/services/core/skill/skillWriteGate.test
 * @description
 * recoverCandidate 的教训同款纪律：这段分支会执行外部动作、会写账，**只能被真跑验证**。
 * 假 deps 记录调用序，execOne 带计数器——"重放没再执行"必须是计数读数，不是读源码。
 */
import {describe, test} from 'node:test'
import assert from 'node:assert/strict'
import {runToolCallsWithWriteGate} from '../../../../services/core/skill/skillWriteGate.js'
import {WRITE_STARTED_MSG} from '../../../../services/core/skill/skillWriteIdempotency.js'

const CFG = {enabled: true, writeTools: ['doc_api/upload'], snapshotMaxChars: 100}
const TC = (id, name = 'doc_api/upload') => ({id, type: 'function', function: {name, arguments: '{}'}})

function makeDeps({row = null, claimReturn = null} = {}) {
    const calls = []
    return {
        calls,
        lookup: async (key) => { calls.push(['lookup', key]); return row },
        claim: async (meta) => { calls.push(['claim', meta.key]); return claimReturn },
        settle: async (key, clip) => { calls.push(['settle', key, clip.text, clip.truncated]) },
    }
}

function makeExec({result = null, throwOn = null} = {}) {
    const seen = []
    return {
        seen,
        execOne: async (toolCall) => {
            seen.push(toolCall.id)
            if (throwOn && throwOn(toolCall)) throw new Error('执行面炸了')
            return result !== null ? [result] : [{tool_call_id: toolCall.id, role: 'tool', content: JSON.stringify({success: true, data: {ok: 1}, tool: toolCall.function.name})}]
        },
    }
}

describe('runToolCallsWithWriteGate 行为面', () => {
    test('闸关：passthrough 直通——execOne 顺序调用、deps 一次都不碰（零账负担）', async () => {
        const deps = makeDeps()
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('t1'), TC('t2')], runCode: 'm1', cfg: {...CFG, enabled: false}, execOne: ex.execOne, deps})
        assert.deepEqual(ex.seen, ['t1', 't2'], '串行同序（旧批量语义）')
        assert.deepEqual(out.map(r => r.tool_call_id), ['t1', 't2'])
        assert.deepEqual(deps.calls, [], '闸关连查账都不发（默认关零副作用）')
    })
    test('名单外（读面）：不查账不记账，直接执行', async () => {
        const deps = makeDeps()
        const ex = makeExec()
        await runToolCallsWithWriteGate({calls: [TC('t1', 'searxng/search')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.deepEqual(ex.seen, ['t1'])
        assert.deepEqual(deps.calls, [])
    })
    test('缺键（无 toolCallId）：闸开也 passthrough，账不碰', async () => {
        const deps = makeDeps()
        const ex = makeExec()
        await runToolCallsWithWriteGate({calls: [{function: {name: 'doc_api/upload', arguments: '{}'}}], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.equal(ex.seen.length, 1)
        assert.deepEqual(deps.calls, [])
    })
    test('first-seen：lookup→claim→执行→settle 全链一次，顺序钉死', async () => {
        const deps = makeDeps()
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.deepEqual(deps.calls.map(c => c[0]), ['lookup', 'claim', 'settle'])
        assert.deepEqual(deps.calls[1], ['claim', 'm1:t1'])
        assert.equal(out[0].tool_call_id, 't1')
        assert.equal(JSON.parse(out[0].content).success, true, '执行结果原样回')
    })
    test('done-hit：replay 返回快照，execOne 零调用、不再 claim/settle', async () => {
        const snap = JSON.stringify({success: true, data: {fileCode: 'fc-1'}})
        const deps = makeDeps({row: {status: 'done', resultSnapshot: snap}})
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.deepEqual(ex.seen, [], '重放命中还执行=闸失效')
        assert.equal(out[0].content, snap, '逐字回放原结果')
        assert.deepEqual(deps.calls.map(c => c[0]), ['lookup'], 'done 行不再 claim')
    })
    test('started 行：refuse——不执行，回话带 WRITE_STARTED_MSG 与 reason 标', async () => {
        const deps = makeDeps({row: {status: 'started'}})
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.deepEqual(ex.seen, [])
        const body = JSON.parse(out[0].content)
        assert.equal(body.success, false)
        assert.equal(body.error, WRITE_STARTED_MSG)
        assert.equal(body.idempotency, 'started-hit')
    })
    test('claim 竞态拿到 done 旧行：replay 且 settle 不发（迟到者不许覆写胜者快照）', async () => {
        const old = {status: 'done', resultSnapshot: 'FIRST'}
        const deps = makeDeps({claimReturn: old})
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.deepEqual(ex.seen, [])
        assert.equal(out[0].content, 'FIRST')
        assert.deepEqual(deps.calls.map(c => c[0]), ['lookup', 'claim'])
    })
    test('claim 竞态拿到 started 旧行（别人在途）：不执行，refuse', async () => {
        const deps = makeDeps({claimReturn: {status: 'started'}})
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.deepEqual(ex.seen, [])
        assert.equal(JSON.parse(out[0].content).idempotency, 'started-hit')
    })
    test('claim 写不进：绝不执行（宁可不干不可双干），如实错误 idempotency=claim-failed', async () => {
        const deps = makeDeps()
        deps.claim = async () => { throw new Error('写不进') }
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.deepEqual(ex.seen, [])
        const body = JSON.parse(out[0].content)
        assert.equal(body.success, false)
        assert.equal(body.idempotency, 'claim-failed')
    })
    test('lookup 读失败：不拦路——继续 claim→执行（"读不到"≠"不存在"，claim 才是终裁）', async () => {
        const deps = makeDeps()
        deps.lookup = async () => { throw new Error('库抖了') }
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.deepEqual(ex.seen, ['t1'])
        assert.equal(JSON.parse(out[0].content).success, true)
        assert.deepEqual(deps.calls.map(c => c[0]), ['claim', 'settle'], '读失败后 claim/settle 照常')
    })
    test('执行 throw：结果如实包装且 **不 settle**（行留 started⇒未来重放 refuse——保险面成立）', async () => {
        const deps = makeDeps()
        const ex = makeExec({throwOn: () => true})
        const out = await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.equal(JSON.parse(out[0].content).success, false)
        assert.deepEqual(deps.calls.map(c => c[0]), ['lookup', 'claim'], 'throw 后不许 settle')
    })
    test('settle 失败：执行结果照常返回（副作用已完成，账停 started 是保守面不是假话）', async () => {
        const deps = makeDeps()
        deps.settle = async () => { throw new Error('账写不进') }
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.equal(JSON.parse(out[0].content).success, true)
    })
    test('快照钳制：超限存截断文本+truncated 标（settle 载荷就是钳过的）', async () => {
        const deps = makeDeps()
        const big = 'x'.repeat(250)
        const ex = makeExec({result: {tool_call_id: 't1', role: 'tool', content: big}})
        await runToolCallsWithWriteGate({calls: [TC('t1')], runCode: 'm1', cfg: {...CFG, snapshotMaxChars: 100}, execOne: ex.execOne, deps})
        const st = deps.calls.find(c => c[0] === 'settle')
        assert.equal(st[2].length, 100)
        assert.equal(st[3], true)
    })
    test('混批：读面+写面同批——读面零账负担、写面走全链，结果同序', async () => {
        const deps = makeDeps()
        const ex = makeExec()
        const out = await runToolCallsWithWriteGate({calls: [TC('r1', 'searxng/search'), TC('w1'), TC('r2', 'searxng/search')], runCode: 'm1', cfg: CFG, execOne: ex.execOne, deps})
        assert.deepEqual(out.map(r => r.tool_call_id), ['r1', 'w1', 'r2'])
        assert.deepEqual(deps.calls.map(c => c[0]), ['lookup', 'claim', 'settle'], '只有写面进账')
    })
    test('execOne 缺失=接线漂移：立刻抛，不静默放行（漂移比失效更糟）', async () => {
        await assert.rejects(() => runToolCallsWithWriteGate({calls: [TC('t1')], cfg: CFG}), /execOne 必填/)
    })
})
