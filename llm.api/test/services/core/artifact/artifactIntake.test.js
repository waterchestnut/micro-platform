/**
 * @fileOverview intake 编排的用例（§9.5 顺序/回滚/完整性在假件上证明）
 * @module test/services/core/artifact/artifactIntake
 * @description
 * deps 全假件：证明的是**编排本身的四条铁律**——顺序合法、回滚起点按外部事实算、补偿按 planRollback 顺序执行、
 * 字节/指纹自算不信任提供方。生产接线的真实读数在 doc.api 放行后的接线刀做，这里不假装有。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/artifact/artifactIntake.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const {runIntake} = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/artifactIntake.js')).href)

const TASK = {artifactCode: 'art-1', idempotencyKey: 'run1:tc1', sandboxId: 'sbx', path: '/workspace/report.pdf', name: 'report.pdf'}

/** 假件脚手架：所有外部动作进 log，失败剧本用 overrides 注入 */
function makeDeps(overrides = {}) {
    const log = {rows: [], cas: [], comps: [], events: [], chunks: [], registers: [], aborted: 0}
    const base = {
        idempotentRun: async (k, fn) => fn(),
        createRow: async (t) => { log.rows.push(t.artifactCode) },
        casState: async (code, from, to) => { log.cas.push([from, to]) },
        waitExecdReady: async () => {},
        pullFile: async ({task, onSlice}) => {
            const parts = task.$parts || ['ABC', 'DE']
            for (let i = 0; i < parts.length; i++) await onSlice(Buffer.from(parts[i]), i)
        },
        beginUpload: () => ({
            write: async (b) => { log.chunks.push(b.toString()) },
            finish: async () => ({fileCode: 'fc-9', fileUrl: 'http://doc/fc-9'}),
            abort: async () => { log.aborted++ },
        }),
        finalizeRegister: async (t, meta) => { log.registers.push(meta) },
        emitArtifactReady: async (doc) => { log.events.push(doc) },
        unregisterArtifact: async (code) => { log.comps.push(['unregister', code]) },
        deleteDocFile: async (code, fc) => { log.comps.push(['delete', code, fc]) },
    }
    return {deps: {...base, ...overrides}, log}
}
const thrower = (msg) => async () => { throw new Error(msg) }

describe('1 快乐路径：顺序、流式完整性、自算指纹', () => {
    test('状态链 started→pulled→uploaded→registered→ready，CAS 恰好 4 步', async () => {
        const {deps, log} = makeDeps()
        const r = await runIntake(TASK, deps)
        assert.equal(r.ok, true)
        assert.deepEqual(r.seen, ['started', 'pulled', 'uploaded', 'registered', 'ready'])
        assert.deepEqual(log.cas, [['started', 'pulled'], ['pulled', 'uploaded'], ['uploaded', 'registered'], ['registered', 'ready']])
        assert.deepEqual(log.comps, [], '成功路径不许有补偿')
    })
    test('字节流按序转投；sha256/size 由编排自算（不信提供方）', async () => {
        const {deps, log} = makeDeps()
        const r = await runIntake({...TASK, $parts: ['ABC', 'DE', 'FGH']}, deps)
        assert.deepEqual(log.chunks, ['ABC', 'DE', 'FGH'], '转投顺序=拉取顺序，不许乱/重/漏')
        const expect = crypto.createHash('sha256').update('ABCDEFGH').digest('hex')
        assert.equal(r.sha256, expect)
        assert.equal(r.sizeBytes, 8)
        assert.equal(r.sliceCount, 3)
        assert.deepEqual(log.registers[0], {fileCode: 'fc-9', fileUrl: 'http://doc/fc-9', sizeBytes: 8, sha256: expect, sliceCount: 3})
    })
    test('name 缺省取 path 尾段', async () => {
        const {deps, log} = makeDeps()
        const t = {...TASK}
        delete t.name
        await runIntake(t, deps)
        assert.equal(log.events[0].name, 'report.pdf')
    })
    test('artifact_ready 事件失败 ⇒ 仍 ready（账行权威），只带 warning，不回滚', async () => {
        const {deps, log} = makeDeps({emitArtifactReady: thrower('sse 断了')})
        const r = await runIntake(TASK, deps)
        assert.equal(r.ok, true)
        assert.equal(r.state, 'ready')
        assert.match(r.warning, /事件发送失败/)
        assert.deepEqual(log.comps, [], '已交付不回头删——那是悬空引用的制造路径')
    })
})

describe('2 失败路径：外部事实决定回滚，不许留洞', () => {
    test('createRow 就炸 ⇒ started 回滚（计划为空），无上传无补偿', async () => {
        const {deps, log} = makeDeps({createRow: thrower('mongo down')})
        const r = await runIntake(TASK, deps)
        assert.equal(r.ok, false)
        assert.equal(r.failedAt, 'started')
        assert.equal(r.state, 'rolled-back')
        assert.deepEqual(r.compensations, [])
        assert.deepEqual(log.cas, [['started', 'rolled-back']])
        assert.equal(log.aborted, 0, '还没 beginUpload')
    })
    test('预热失败 ⇒ started 回滚（execd 没起来不算产物失败之外的事）', async () => {
        const {deps} = makeDeps({waitExecdReady: thrower('execd 45s 未就绪')})
        const r = await runIntake(TASK, deps)
        assert.equal(r.failedAt, 'started')
        assert.equal(r.state, 'rolled-back')
    })
    test('拉一半断 ⇒ 未确立 pulled 事实：abort 尽力、started 回滚、绝不登记', async () => {
        const {deps, log} = makeDeps({
            pullFile: async ({onSlice}) => {
                await onSlice(Buffer.from('ABC'), 0)
                throw new Error('分段取回异常')
            },
        })
        const r = await runIntake(TASK, deps)
        assert.equal(r.failedAt, 'started', '半截字节不是"已拉取"事实')
        assert.equal(r.state, 'rolled-back')
        assert.equal(log.aborted, 1, '上传会话必须被 abort（残片归 uploader）')
        assert.deepEqual(log.registers, [])
        assert.deepEqual(log.events, [])
    })
    test('finish 抛 ⇒ pulled 已确立但未上传：plan 为空、abort 调用、不删不存在文件', async () => {
        const {deps, log} = makeDeps({beginUpload: () => ({write: async () => {}, finish: thrower('502'), abort: async () => { log.aborted++ }})})
        const r = await runIntake(TASK, deps)
        assert.equal(r.failedAt, 'pulled')
        assert.equal(r.state, 'rolled-back')
        assert.deepEqual(r.compensations, [], '没有完整文件，delete 无从谈起')
        assert.equal(log.aborted, 1)
    })
    test('finish 成功却不给 fileCode ⇒ FAILED（外部不可知），绝不登记没把手的产物', async () => {
        const {deps, log} = makeDeps({beginUpload: () => ({write: async () => {}, finish: async () => ({fileUrl: 'x'}), abort: async () => { log.aborted++ }})})
        const r = await runIntake(TASK, deps)
        assert.equal(r.ok, false)
        assert.equal(r.state, 'failed')
        assert.match(r.error, /fileCode/)
        assert.equal(log.aborted, 1)
        assert.deepEqual(log.registers, [])
    })
    test('登记失败 ⇒ uploaded 事实：只删文件、不注销（没登记可注销）', async () => {
        const {deps, log} = makeDeps({finalizeRegister: thrower('唯一索引撞了')})
        const r = await runIntake(TASK, deps)
        assert.equal(r.failedAt, 'uploaded')
        assert.deepEqual(r.compensations, ['delete-doc-api-file'])
        assert.deepEqual(log.comps, [['delete', 'art-1', 'fc-9']])
        assert.equal(r.state, 'rolled-back')
    })
    test('ready 的 CAS 失败 ⇒ registered 事实：补偿顺序 unregister→delete（逆序回滚不许排反）', async () => {
        const {deps, log} = makeDeps({casState: async (code, from, to) => {
            log.cas.push([from, to])
            if (to === 'ready') throw new Error('mongo write conflict')
        }})
        const r = await runIntake(TASK, deps)
        assert.equal(r.failedAt, 'registered')
        assert.deepEqual(r.compensations, ['unregister-artifact', 'delete-doc-api-file'])
        assert.deepEqual(log.comps.map((x) => x[0]), ['unregister', 'delete'], '顺序=planRollback 给的顺序')
        assert.equal(r.state, 'rolled-back')
        assert.equal(log.aborted, 0, '已上传成功：不该 abort，该走 delete 补偿')
    })
    test('UPLOADED 的 CAS 写失败但文件已在 ⇒ 回滚仍按外部事实删文件（账状态是旧的，世界不是）', async () => {
        const {deps, log} = makeDeps({casState: async (code, from, to) => {
            log.cas.push([from, to])
            if (to === 'uploaded') throw new Error('mongo write conflict')
        }})
        const r = await runIntake(TASK, deps)
        assert.equal(r.failedAt, 'uploaded', '回滚起点=最深外部事实，不是 CAS 里那个旧状态')
        assert.deepEqual(r.compensations, ['delete-doc-api-file'])
        assert.deepEqual(log.comps, [['delete', 'art-1', 'fc-9']])
        assert.equal(r.state, 'rolled-back')
    })
    test('补偿执行器抛 ⇒ FAILED（"清过"是假话），已完成的补偿如实列出', async () => {
        const {deps} = makeDeps({finalizeRegister: thrower('boom'), deleteDocFile: thrower('doc.api 403')})
        const r = await runIntake(TASK, deps)
        assert.equal(r.state, 'failed')
        assert.match(r.error, /补偿 delete-doc-api-file 失败/)
    })
    test('缺补偿执行器 ⇒ FAILED 并点名缺哪个（没牙的回滚不算回滚）', async () => {
        const local = makeDeps({finalizeRegister: thrower('boom')})
        delete local.deps.deleteDocFile
        const r = await runIntake(TASK, local.deps)
        assert.equal(r.state, 'failed')
        assert.match(r.error, /缺执行器 delete-doc-api-file/)
    })
})

describe('3 接线纪律', () => {
    test('缺必需依赖 ⇒ 抛（这是接线错误，不是运行失败）', async () => {
        const local = makeDeps()
        delete local.deps.pullFile
        await assert.rejects(runIntake(TASK, local.deps), /缺依赖 pullFile/)
        await assert.rejects(runIntake({...TASK, artifactCode: ''}, makeDeps().deps), /artifactCode 不能为空/)
    })
    test('idempotentRun 的包裹语义：同键重放只跑一次流水线', async () => {
        const store = new Map()
        const local = makeDeps({idempotentRun: async (k, fn) => {
            if (store.has(k)) return store.get(k)
            const r = await fn()
            store.set(k, r)
            return r
        }})
        const a = await runIntake(TASK, local.deps)
        const b = await runIntake(TASK, local.deps)
        assert.equal(a, b)
        assert.equal(local.log.rows.length, 1, '重放不许二次建账/二次上传')
    })
    test('编排是纯逻辑：不 import 网络/库层，只依赖 node:crypto 与判据', async () => {
        const src = fs.readFileSync(path.join(SRC, 'services/core/artifact/artifactIntake.js'), 'utf8')
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
        assert.deepEqual(imports.sort(), ['./artifactReconcile.js', 'node:crypto'], `编排只准依赖指纹计算与判据：${JSON.stringify(imports)}`)
        assert.ok(!/fetch\(|mongoose|dac|l2Cache/.test(code), '网络/库层都是注入 deps，编排文件里不许出现')
    })
})
