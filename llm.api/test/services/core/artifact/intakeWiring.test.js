/**
 * @fileOverview intake 生产装配的用例（wiring 件 + llmChat/llmLoop 接线守卫）
 * @module test/services/core/artifact/intakeWiring
 * @description
 * 与 planWiring.test.js 同纪律：纯模块测绿只证明"判据对"，不证明"主循环真的走到它们"。
 * 本档两头都测——①wiring 件（预热环/幂等锁/tombstone/deps 组装）用假件走**真函数体**；
 * ②接线守卫对 llmChat/llmLoop 源码断言"开时被走到、关时零痕迹"，锚点先剥注释（本档反复栽的坑）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/artifact/intakeWiring.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const W = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/intakeWiring.js')).href)

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const codeOf = (rel) => strip(fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, ''))

describe('1 pingWaitReady：重试环 + 失败不销毁', () => {
    test('第 2 次通 ⇒ 返回 true 且共探 2 次', async () => {
        let n = 0
        const client = {fileProxyBase: () => 'http://p', callRaw: async () => ({ok: ++n >= 2, status: 200})}
        assert.equal(await W.pingWaitReady(client, 'sbx', {tries: 5, intervalMs: 1}), true)
        assert.equal(n, 2)
    })
    test('全部失败 ⇒ 抛，且**绝不** destroySandbox（假件根本没这方法：调了必 TypeError）', async () => {
        const client = {fileProxyBase: () => 'http://p', callRaw: async () => ({ok: false, status: 502})}
        await assert.rejects(W.pingWaitReady(client, 'sbx', {tries: 3, intervalMs: 1}), /未就绪/)
    })
    test('callRaw 抛异常也被吞进重试（网络抖≠直接失败）', async () => {
        let n = 0
        const client = {fileProxyBase: () => 'http://p', callRaw: async () => { n++; if (n < 3) throw new Error('socket'); return {ok: true} }}
        assert.equal(await W.pingWaitReady(client, 'sbx', {tries: 5, intervalMs: 1}), true)
    })
})

describe('2 tombstoneDocFile：0 字节覆盖同 fileCode', () => {
    test('打到 upload/unique?fileCode=，体为空、带 user-info', async () => {
        let seen = null
        const fetchImpl = async (url, init) => {
            seen = {url, init}
            return {status: 200, ok: true, json: async () => ({code: 0, data: {fileCode: 'f-9', fileSize: 0}})}
        }
        const ret = await W.tombstoneDocFile({fileCode: 'f-9', docApiConfig: {baseIntranetUrl: 'http://doc'}, userInfo: {userCode: 'u1'}, fetchImpl})
        assert.match(seen.url, /\/file\/upload\/unique\?fileCode=f-9$/)
        assert.equal(ret.sizeBytes, 0)
        assert.ok(seen.init.headers['user-info'])
    })
    test('缺 fileCode 直接拒（不拿空 query 去覆盖随机一片）', async () => {
        await assert.rejects(W.tombstoneDocFile({fileCode: '', docApiConfig: {baseIntranetUrl: 'http://d'}}), /fileCode/)
    })
})

describe('3 makeIntakeDeps：幂等锁与各槽位对接', () => {
    const baseParams = (over = {}) => ({
        client: over.client || {fileProxyBase: () => 'http://p', callRaw: async () => ({ok: true}), fetchFileBytes: async ({onSlice}) => { await onSlice(Buffer.from('AB'), 0); return {total: 2, sliceCount: 1, bytes: 2} }},
        dac: over.dac || {
            created: [], cas: [], reg: [], unreg: [], stamp: [],
            createStarted(t) { this.created.push(t.artifactCode) },
            casState(c, f, to) { this.cas.push([f, to]) },
            setRegisterResult(c, m) { this.reg.push([c, m]) },
            markUnregistered(c) { this.unreg.push(c) },
            stampReadyAt(c) { this.stamp.push(c) },
        },
        docApiConfig: {baseIntranetUrl: 'http://doc'},
        artifactConfig: {dedupSeconds: 60},
        userInfo: {userCode: 'u1'},
        acquireOnce: over.acquireOnce || (async () => true),
        streamEvent: over.streamEvent,
    })

    test('idempotentRun：锁没抢到 ⇒ dedupSkipped 且不跑流水线', async () => {
        let ran = 0
        const deps = W.makeIntakeDeps({...baseParams(), acquireOnce: async () => false})
        const ret = await deps.idempotentRun('k', async () => { ran++; return {ok: true} })
        assert.equal(ran, 0)
        assert.equal(ret.ok, false)
        assert.equal(ret.dedupSkipped, true, '是包裹层结论，不是 intake 状态词表里的东西')
    })
    test('idempotentRun：抢到锁 ⇒ 原样跑', async () => {
        const deps = W.makeIntakeDeps(baseParams())
        assert.equal((await deps.idempotentRun('k', async () => ({ok: true, n: 1}))).n, 1)
    })
    test('无 key ⇒ 不抢锁（幂等键缺失时不许拿 undefined 当锁名）', async () => {
        let calls = 0
        const deps = W.makeIntakeDeps({...baseParams(), acquireOnce: async () => { calls++; return true }})
        await deps.idempotentRun('', async () => ({ok: true}))
        assert.equal(calls, 0)
    })
    test('全链装配：createRow/cas/预热/pull/upload/register/emit 各就各位（runIntake 走一遍）', async () => {
        const p = baseParams()
        const events = []
        const fetchImpl = async () => ({status: 200, ok: true, json: async () => ({code: 0, data: {fileCode: 'fc-alloc', fileSize: 2}})})
        const deps = W.makeIntakeDeps({...p, streamEvent: (t, payload) => events.push([t, payload])})
        // 装配面先整体点名，再把 beginUpload 换成"真 uploader + 假 fetch"（真件语义，不另造假上传器）
        for (const k of ['idempotentRun', 'createRow', 'casState', 'waitExecdReady', 'pullFile', 'beginUpload', 'finalizeRegister', 'emitArtifactReady', 'unregisterArtifact', 'deleteDocFile']) {
            assert.equal(typeof deps[k], 'function', `deps.${k} 必须是函数`)
        }
        const {runIntake} = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/artifactIntake.js')).href)
        const docMod = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/docApiUpload.js')).href)
        deps.beginUpload = ({task}) => docMod.makeDocApiUploader({task, config: {baseIntranetUrl: 'http://doc'}, userInfo: {userCode: 'u'}, fetchImpl})
        const ret = await runIntake({artifactCode: 'a-1', idempotencyKey: 'r1:t1', sandboxId: 'sb', path: '/workspace/a', fileCode: 'fc-alloc', messageCode: 'msg-9'}, deps)
        assert.equal(ret.ok, true)
        assert.equal(p.dac.created.length, 1)
        assert.deepEqual(p.dac.cas.map((x) => x[1]).filter((s) => s !== 'rolled-back'), ['pulled', 'uploaded', 'registered', 'ready'])
        assert.equal(p.dac.reg.length, 1, 'finalizeRegister 走了 dac')
        assert.equal(p.dac.reg[0][1].messageCode, 'msg-9', '挂载位在登记步落账（引用保护从此刻生效）')
        assert.equal(p.dac.stamp.length, 1, 'readyAt 落了 dac')
        assert.deepEqual(events[0][0], 'artifact_ready')
        assert.equal(events[0][1].fileCode, 'fc-alloc')
        assert.equal(ret.sizeBytes, 2)
    })
})

describe('4 llmChat/llmLoop 接线守卫（源码级，开时被走到）', () => {
    const chat = () => codeOf('services/core/llmChat.js')
    const loop = () => codeOf('services/core/llmLoop.js')
    test('下发：artifactOn 由双开关算出，save/read 两件都在门控分支内', () => {
        const c = chat()
        assert.match(c, /const artifactOn = saveArtifactToolEnabled\(artifactCfg, config\.sandboxConfig \|\| \{\}\)/)
        assert.match(c, /if \(artifactOn\) \{\s*\n\s*allTools\.push\(\.\.\.buildSaveArtifactTools\(\)\)[\s\S]{0,120}?allTools\.push\(\.\.\.buildReadArtifactTools\(\)\)/,
            'save/read 必须同进同出：能存不能取回，"压缩≠丢信息"就是空话')
    })
    test('分派：save∪read 都算 artifact 通道，classify 传的是通道谓词', () => {
        const c = chat()
        assert.match(c, /isArtifactTool: \(n\) => isSaveArtifactTool\(n\) \|\| isReadArtifactTool\(n\)/,
            '通道谓词漏半边 ⇒ 另一半被丢给 mcpToolManager')
        assert.match(c, /const \{[^}]*\battachmentCalls\b[^}]*\} =/, '解构清单缺 attachmentCalls（包含式断言，新谓词随迁不再误红）')
        const l = loop()
        assert.match(l, /!isPlan\(tc\.function\?\.name\) && !isArtifact\(tc\.function\?\.name\)/, 'otherCalls 取反串漏了 artifact ⇒ 会被丢给 mcpToolManager')
    })
    test('执行：artifactCalls 非空才懒加载 wiring；read/save 各走各的执行体；结果并入 toolResults', () => {
        const c = chat()
        assert.match(c, /if \(artifactCalls\.length\) \{[\s\S]*?import\('\.\/artifact\/intakeWiring\.js'\)[\s\S]*?makeArtifactReader/)
        assert.match(c, /isReadArtifactTool\(toolCall\?\.function\?\.name\)\s*\n?\s*\?\s*executeReadArtifactTool/, 'read 调用没分给 executeReadArtifactTool')
        assert.match(c, /:\s*executeSaveArtifactTool\(\{/)
        assert.match(c, /\.\.\.planResults, \.\.\.artifactResults, \.\.\.askResults/, '结果没并进 toolResults = 模型收不到工具回执')
    })
    test('上下文：runCode=messageCode、sandboxId 走 peekSharedSandboxId（不凭空建箱）', () => {
        const c = chat()
        assert.match(c, /runCode: messageCode/)
        assert.match(c, /sandboxId: peekSharedSandboxId\(conversationCode\)/)
    })
})

describe('5 makeArtifactReader：读形状对齐 live 实测（探针阶段1 的 GET download）', () => {
    const W = () => import(pathToFileURL(path.join(SRC, 'services/core/artifact/intakeWiring.js')).href)
    test('URL 走内网 base + 编码 fileCode；带 user-info；返回 Buffer', async () => {
        const mod = await W()
        let seen = null
        const reader = mod.makeArtifactReader({
            docApiConfig: {baseIntranetUrl: 'http://doc.internal', baseUrl: 'https://pub'},
            userInfo: {userCode: 'u1', realName: '张三'},
            fetchImpl: async (url, init) => {
                seen = {url, init}
                const body = Buffer.from('内容')
                return {ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length)}
            },
        })
        const buf = await reader.fetchArtifactBytes({fileCode: 'fc 9'})
        assert.equal(buf.toString('utf8'), '内容')
        assert.equal(seen.url, 'http://doc.internal/file/download?fileCode=fc%209', '服务器自己读必须走内网 base，不是账上的对外 fileUrl')
        assert.ok(seen.init.headers['user-info'])
    })
    test('非 2xx ⇒ 抛并带状态码（不静默回空 Buffer 让模型读出一页空）', async () => {
        const mod = await W()
        const reader = mod.makeArtifactReader({
            docApiConfig: {baseIntranetUrl: 'http://d'},
            fetchImpl: async () => ({ok: false, status: 410, text: async () => 'gone'}),
        })
        await assert.rejects(reader.fetchArtifactBytes({fileCode: 'f'}), /410.*gone/)
    })
    test('缺 base / 缺 fileCode ⇒ 各抛各的（不拼出废 URL）', async () => {
        const mod = await W()
        const r1 = mod.makeArtifactReader({docApiConfig: {}, fetchImpl: async () => { throw new Error('不该发生') }})
        await assert.rejects(r1.fetchArtifactBytes({fileCode: 'f'}), /基地址/)
        const r2 = mod.makeArtifactReader({docApiConfig: {baseIntranetUrl: 'http://d'}})
        await assert.rejects(r2.fetchArtifactBytes({}), /fileCode/)
    })
    test('findArtifact 用注入 dac 的 findByArtifactCode；注销行如实透传（拒读话术归执行体）', async () => {
        const mod = await W()
        let hit = null
        const dac = {findByArtifactCode: async (c) => { hit = c; return {artifactCode: c, status: -1} }}
        const reader = mod.makeArtifactReader({docApiConfig: {baseIntranetUrl: 'http://d'}, dac})
        const row = await reader.findArtifact('art-9')
        assert.equal(hit, 'art-9')
        assert.equal(row.status, -1)
    })
})
