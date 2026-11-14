/**
 * @fileOverview read_artifact 纯件的用例（§9.5 line 813 "压缩≠丢信息"的取回面）
 * @module test/services/core/artifact/readArtifactTool
 * @description
 * 钉三条：①**字符切片必须码点安全**（代理对劈中缝=乱码页，模型会把坏字符当正文背下去）；
 * ②账的"活/死/半路"三态如实拒（注销、在途、被标 broken 都不给内容，且各说各的理由）；
 * ③上限闸门在**读之前**把关（整文件读模型下，拒读大文件并说明，不悄悄吃带宽）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/artifact/readArtifactTool.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const M = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/readArtifactTool.js')).href)
const {
    READ_ARTIFACT_TOOL_NAME, DEFAULT_LIMIT_CHARS, MAX_LIMIT_CHARS,
    buildReadArtifactTools, isReadArtifactTool, validateReadArgs, sliceArtifactText, executeReadArtifactTool,
} = M
const {INTAKE_ERRORS} = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/intakeErrors.js')).href)

const toolCall = (args, id = 'tc-r1') => ({id, function: {name: READ_ARTIFACT_TOOL_NAME, arguments: JSON.stringify(args)}})
const parse = (msg) => JSON.parse(msg.content)
const readyRow = {artifactCode: 'art-1', state: 'ready', integrity: 'ok', status: 0, fileCode: 'fc-1', name: 'plan.json', sizeBytes: 100, sha256: 'ab12'}

describe('1 schema 与谓词', () => {
    test('工具形：artifactCode 必填，名字唯一', () => {
        const t = buildReadArtifactTools()[0]
        assert.equal(t.function.name, 'read_artifact')
        assert.deepEqual(t.function.parameters.required, ['artifactCode'])
        assert.ok(isReadArtifactTool('read_artifact'))
        assert.ok(!isReadArtifactTool('save_artifact'), 'save/read 同通道不同名，谓词不许互相吞')
    })
})

describe('2 validateReadArgs', () => {
    test('空 code / 非法 offset / 非法 limit 各自拒', () => {
        assert.equal(validateReadArgs({}).ok, false)
        assert.equal(validateReadArgs({artifactCode: ' ', offset: 1}).ok, false)
        assert.equal(validateReadArgs({artifactCode: 'a', offset: -1}).ok, false)
        assert.equal(validateReadArgs({artifactCode: 'a', offset: 1.5}).ok, false)
        assert.equal(validateReadArgs({artifactCode: 'a', limit: 0}).ok, false)
    })
    test('缺省值：offset=0、limit=默认；超大 limit 钳到上限且带 warning（不是失败）', () => {
        const v = validateReadArgs({artifactCode: 'a'})
        assert.deepEqual(v.value, {artifactCode: 'a', offset: 0, limit: DEFAULT_LIMIT_CHARS})
        const c = validateReadArgs({artifactCode: 'a', limit: 999999})
        assert.equal(c.value.limit, MAX_LIMIT_CHARS)
        assert.equal(c.warnings.length, 1, '钳制必须留痕')
    })
})

describe('3 sliceArtifactText：码点安全是底线', () => {
    test('中英混排按字符切，页界不劈多字节', () => {
        const text = '报告A中文😀tail'
        for (let off = 0; off <= 9; off++) {
            for (const lim of [1, 2, 5]) {
                const p = sliceArtifactText(text, off, lim)
                assert.ok(!/\uFFFD/.test(p.text), `offset=${off} limit=${lim} 出现替换符=劈到了字节中缝`)
            }
        }
    })
    test('代理对（emoji）整对进出：limit=1 也不劈开 😀', () => {
        const p = sliceArtifactText('a😀b', 1, 1)
        assert.equal(p.text, '😀')
        assert.equal(p.totalChars, 3, '码点计数：a/😀/b = 3，不是 UTF-16 的 4')
        assert.equal(p.remainingChars, 1)
    })
    test('边界数学：offset+limit 越尾 ⇒ hasMore=false、remaining=0；空文 ⇒ 全零', () => {
        const mid = sliceArtifactText('0123456789', 3, 5)
        assert.equal(mid.text, '34567')
        assert.equal(mid.hasMore, true)
        assert.equal(mid.remainingChars, 2)
        const tail = sliceArtifactText('0123456789', 8, 5)
        assert.equal(tail.text, '89')
        assert.equal(tail.hasMore, false)
        assert.equal(tail.remainingChars, 0)
        const empty = sliceArtifactText('', 0, 5)
        assert.deepEqual([empty.totalChars, empty.remainingChars, empty.hasMore], [0, 0, false])
    })
    test('Buffer 输入按 UTF-8 解码（生产 fetch 回来就是 Buffer）', () => {
        const p = sliceArtifactText(Buffer.from('中文', 'utf8'), 0, 2)
        assert.equal(p.text, '中文')
    })
})

describe('4 executeReadArtifactTool：账态与闸门口径', () => {
    const run = async (args, deps, cfg = {}) => parse(await executeReadArtifactTool({toolCall: toolCall(args), deps, artifactConfig: cfg}))
    test('非法 JSON / 参数错 / 未接线 ⇒ success:false（未接线带专用码）', async () => {
        const bad = parse(await executeReadArtifactTool({toolCall: {id: 'x', function: {arguments: '{'}}, deps: {}}))
        assert.equal(bad.success, false)
        assert.match(bad.error, /JSON/)
        assert.equal((await run({}, {})).success, false)
        const unwired = await run({artifactCode: 'a'}, {})
        assert.equal(unwired.success, false)
        assert.match(unwired.error, new RegExp(INTAKE_ERRORS.TOOL_WIRING_NOT_READY))
    })
    test('无账行 ⇒ 明说"不存在"（区别于注销/在途）', async () => {
        const r = await run({artifactCode: 'nope'}, {findArtifact: async () => null, fetchArtifactBytes: async () => Buffer.from('x')})
        assert.equal(r.success, false)
        assert.match(r.error, /不存在/)
    })
    test('注销/在途/broken 三态各给各的理由，都不吐内容', async () => {
        const mk = (row) => ({findArtifact: async () => row, fetchArtifactBytes: async () => { throw new Error('不该被调用') }})
        const dead = await run({artifactCode: 'a'}, mk({...readyRow, status: -1}))
        assert.match(dead.error, /注销/)
        const inflight = await run({artifactCode: 'a'}, mk({...readyRow, state: 'uploaded'}))
        assert.match(inflight.error, /尚未入库完成/)
        assert.equal(inflight.data.state, 'uploaded')
        const broken = await run({artifactCode: 'a'}, mk({...readyRow, integrity: 'broken'}))
        assert.match(broken.error, /broken/)
    })
    test('字节上限在 fetch 之前把关（超限零次内容读）', async () => {
        let fetched = 0
        const deps = {findArtifact: async () => ({...readyRow, sizeBytes: 999}), fetchArtifactBytes: async () => { fetched++; return Buffer.from('x') }}
        const r = await run({artifactCode: 'a'}, deps, {maxArtifactBytes: 100})
        assert.equal(r.success, false)
        assert.match(r.error, /超过单次读上限/)
        assert.equal(fetched, 0)
    })
    test('读失败 ⇒ 如实报错带 state（查得到账但拿不回内容要能说清）', async () => {
        const deps = {findArtifact: async () => readyRow, fetchArtifactBytes: async () => { throw new Error('doc.api 502') }}
        const r = await run({artifactCode: 'a'}, deps)
        assert.equal(r.success, false)
        assert.match(r.error, /读取内容失败.*502/)
        assert.equal(r.data.state, 'ready')
    })
    test('offset 越界拒（别给"空页=读完"的假象）', async () => {
        const deps = {findArtifact: async () => readyRow, fetchArtifactBytes: async () => Buffer.from('短') }
        const r = await run({artifactCode: 'a', offset: 5}, deps)
        assert.equal(r.success, false)
        assert.match(r.error, /越过末尾/)
        assert.equal(r.data.totalChars, 1)
    })
    test('成功页：text/totalChars/remainingChars/hasMore/sha256 齐且数学自洽', async () => {
        const content = Buffer.from('x'.repeat(50), 'utf8')
        const deps = {findArtifact: async () => readyRow, fetchArtifactBytes: async () => content}
        const p1 = await run({artifactCode: 'a', offset: 0, limit: 20}, deps)
        assert.equal(p1.success, true)
        assert.equal(p1.data.text.length, 20)
        assert.equal(p1.data.totalChars, 50)
        assert.equal(p1.data.remainingChars, 30)
        assert.equal(p1.data.hasMore, true)
        assert.equal(p1.data.sha256, 'ab12')
        assert.equal(p1.data.name, 'plan.json')
        const p3 = await run({artifactCode: 'a', offset: 40, limit: 20}, deps)
        assert.equal(p3.data.remainingChars, 0)
        assert.equal(p3.data.hasMore, false)
        assert.equal(p3.data.text.length, 10)
    })
    test('limit 钳制的 warning 回吐进 normalized（修而留痕，同 save 侧纪律）', async () => {
        const deps = {findArtifact: async () => readyRow, fetchArtifactBytes: async () => Buffer.from('abc')}
        const r = await run({artifactCode: 'a', limit: 999999}, deps)
        assert.equal(r.success, true)
        assert.ok(Array.isArray(r.data.normalized) && r.data.normalized.some((w) => /钳制/.test(w)))
    })
})

describe('5 纯件纪律', () => {
    test('只依赖 intakeErrors；无 IO/全局', () => {
        const src = fs.readFileSync(path.join(SRC, 'services/core/artifact/readArtifactTool.js'), 'utf8')
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
        assert.deepEqual(imports, ['./intakeErrors.js'], `纯件只准依赖错误码：${JSON.stringify(imports)}`)
        assert.ok(!/fetch\(|mongoose|llm\.(config|tools|logger)/.test(code), 'IO 与全局全走注入')
    })
})
