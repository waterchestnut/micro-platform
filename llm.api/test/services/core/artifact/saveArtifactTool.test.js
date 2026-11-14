/**
 * @fileOverview save_artifact 工具纯件的用例
 * @module test/services/core/artifact/saveArtifactTool
 * @description
 * 钉三条最值钱的：①入参边界（非 /workspace/、`..`、目录、脏 name 全拒）；
 * ②**修而留痕**（kind 纠正必须进 warnings 并回吐给模型，静默修正是这类功能最阴的失效）；
 * ③幂等键组装 `${runCode}:${toolCallId}`（§7 line 741，重放不双登的根）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/artifact/saveArtifactTool.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const M = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/saveArtifactTool.js')).href)
const {
    SAVE_ARTIFACT_TOOL_NAME, ARTIFACT_KINDS, buildSaveArtifactTools, isSaveArtifactTool,
    saveArtifactToolEnabled, validateSaveArtifactArgs, deriveIntakeTask, executeSaveArtifactTool,
} = M
const {INTAKE_ERRORS} = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/intakeErrors.js')).href)

const ON = {artifactConfig: {enabled: true}, sandboxConfig: {enabled: true}}
const CTX = {conversationCode: 'c-1', channel: 'app', userCode: 'u-1', runCode: 'r-9', toolCallId: 'ignored', sandboxId: 'sbx-1'}
const toolCall = (args, id = 'tc-7') => ({id, function: {name: SAVE_ARTIFACT_TOOL_NAME, arguments: JSON.stringify(args)}})
const parse = (msg) => JSON.parse(msg.content)

describe('1 schema 与开关', () => {
    test('工具形：名字/path 必填/kind 枚举', () => {
        const t = buildSaveArtifactTools()[0]
        assert.equal(t.function.name, 'save_artifact')
        assert.deepEqual(t.function.parameters.required, ['path'])
        assert.deepEqual(t.function.parameters.properties.kind.enum, ARTIFACT_KINDS)
        assert.ok(!('content' in t.function.parameters.properties), '模型交不出内容参数——字节只能服务端取')
    })
    test('isSaveArtifactTool 只认同名', () => {
        assert.equal(isSaveArtifactTool('save_artifact'), true)
        assert.equal(isSaveArtifactTool('saveArtifact'), false)
        assert.equal(isSaveArtifactTool(undefined), false)
    })
    test('默认关；且必须 artifact+sandbox 同开（无沙箱此工具无意义）', () => {
        assert.equal(saveArtifactToolEnabled({}, {}), false)
        assert.equal(saveArtifactToolEnabled({enabled: true}, {}), false)
        assert.equal(saveArtifactToolEnabled({enabled: true}, {enabled: true}), true)
        assert.equal(saveArtifactToolEnabled(undefined, undefined), false)
    })
})

describe('2 validateSaveArtifactArgs：边界与修而留痕', () => {
    test('合法 /workspace/ 路径：name 缺省取尾段、kind 缺省 file', () => {
        const v = validateSaveArtifactArgs({path: '/workspace/out/report.pdf'})
        assert.equal(v.ok, true)
        assert.deepEqual(v.value, {path: '/workspace/out/report.pdf', name: 'report.pdf', kind: 'file'})
        assert.deepEqual(v.warnings, [])
    })
    test('拒：空/相对/非 workspace/etc 穿越/.. 段/目录斜杠结尾', () => {
        for (const bad of ['', '  ', 'out.pdf', './a.txt', '/etc/passwd', '/workspace/../etc/passwd', '/workspace/', '/workspace//']) {
            const v = validateSaveArtifactArgs({path: bad})
            assert.equal(v.ok, false, `${JSON.stringify(bad)} 必须被拒`)
            assert.ok(v.error, '拒绝必须给原因')
        }
    })
    test('拒脏 name：分隔符/控制字符/超长；显式合法 name 生效', () => {
        assert.equal(validateSaveArtifactArgs({path: '/workspace/a', name: 'x/y'}).ok, false)
        assert.equal(validateSaveArtifactArgs({path: '/workspace/a', name: 'x\\y'}).ok, false)
        assert.equal(validateSaveArtifactArgs({path: '/workspace/a', name: 'a\nb'}).ok, false)
        assert.equal(validateSaveArtifactArgs({path: '/workspace/a', name: 'n'.repeat(121)}).ok, false)
        assert.equal(validateSaveArtifactArgs({path: '/workspace/a', name: '报告 v2.pdf'}).value.name, '报告 v2.pdf')
    })
    test('kind 未知 ⇒ 不整次失败，改 file 但 warnings 必须看得见（修而留痕）', () => {
        const v = validateSaveArtifactArgs({path: '/workspace/a', kind: 'spreadsheet'})
        assert.equal(v.ok, true)
        assert.equal(v.value.kind, 'file')
        assert.equal(v.warnings.length, 1)
        assert.match(v.warnings[0], /spreadsheet/)
        assert.equal(validateSaveArtifactArgs({path: '/workspace/a', kind: 'DATA'}).value.kind, 'data', '大小写归一是宽容不是失败')
    })
})

describe('3 deriveIntakeTask：幂等键与分配即锚', () => {
    let seq = 0
    const genCode = (p) => `${p}-${++seq}`
    test('缺 genCode ⇒ 抛（标识生成属接线面，纯件不自己造 uuid）', () => {
        assert.throws(() => deriveIntakeTask({value: {path: '/workspace/a', name: 'a', kind: 'file'}, context: CTX}), /genCode/)
    })
    test('缺上下文 ⇒ 点名缺哪几个（runCode/toolCallId/sandboxId/conversationCode 一个都不能少）', () => {
        assert.throws(() => deriveIntakeTask({value: {path: '/w/a', name: 'a', kind: 'file'}, context: {}, genCode}), /缺上下文.*runCode.*toolCallId/s)
    })
    test('组装：idempotencyKey=`runCode:toolCallId`、链根=自身、fileCode 已分配、limits 透传', () => {
        const before = seq
        const t = deriveIntakeTask({
            value: {path: '/workspace/a.bin', name: 'a.bin', kind: 'file'},
            context: {...CTX, toolCallId: 'tc-real'},
            genCode,
            limits: {maxTotalBytes: 1024, sliceBytes: 256},
        })
        assert.equal(t.idempotencyKey, 'r-9:tc-real', '§7 line 741 的组装点')
        assert.equal(t.version, 1)
        assert.equal(t.lineageRootArtifactCode, t.artifactCode, '单元素链：自己为根')
        assert.ok(t.artifactCode.startsWith('art-'), 'artifactCode 来自注入 genCode')
        assert.ok(t.fileCode.startsWith('docfile-'), 'fileCode **在传输前**分配（alloc-without-record 可观测的前提）')
        assert.equal(t.maxTotalBytes, 1024)
        assert.equal(t.sliceBytes, 256)
        assert.equal(seq - before, 2, '恰好烧两个标识：art + docfile')
    })
})

describe('4 executeSaveArtifactTool：全失败路径 success:false，不抛', () => {
    test('非法 JSON ⇒ success:false', async () => {
        const r = parse(await executeSaveArtifactTool({toolCall: {id: 'x', function: {arguments: '{bad'}}, ...ON}))
        assert.equal(r.success, false)
        assert.match(r.error, /JSON/)
    })
    test('未开放 ⇒ 提示开关节名（artifact_enabled）', async () => {
        const r = parse(await executeSaveArtifactTool({toolCall: toolCall({path: '/workspace/a'}), artifactConfig: {}, sandboxConfig: {}}))
        assert.equal(r.success, false)
        assert.match(r.error, /artifact_enabled/)
    })
    test('接线未就绪 ⇒ TOOL_WIRING_NOT_READY 码（不是拿别的码凑数）', async () => {
        const r = parse(await executeSaveArtifactTool({toolCall: toolCall({path: '/workspace/a'}), ...ON}))
        assert.equal(r.success, false)
        assert.match(r.error, new RegExp(INTAKE_ERRORS.TOOL_WIRING_NOT_READY))
    })
    test('校验失败 ⇒ 错误+warnings 都回吐', async () => {
        const r = parse(await executeSaveArtifactTool({toolCall: toolCall({path: '/etc/passwd'}), context: CTX, runIntake: async () => ({}), genCode: () => 'x', ...ON}))
        assert.equal(r.success, false)
        assert.match(r.error, /workspace/)
    })
    test('成功透传：task 的 toolCallId 取 toolCall.id（不信 context 里那个）', async () => {
        let seenTask = null
        const runIntake = async (t) => {
            seenTask = t
            return {ok: true, artifactCode: t.artifactCode, fileCode: 'fc-1', fileUrl: 'http://d/fc-1', sizeBytes: 8, sha256: 'ab'}
        }
        const r = parse(await executeSaveArtifactTool({toolCall: toolCall({path: '/workspace/a.bin', kind: 'sheet'}, 'tc-42'), context: CTX, runIntake, genCode: (p) => `${p}-1`, ...ON}))
        assert.equal(r.success, true)
        assert.equal(seenTask.toolCallId, 'tc-42')
        assert.equal(seenTask.idempotencyKey, 'r-9:tc-42')
        assert.equal(r.data.fileCode, 'fc-1')
        assert.equal(r.data.kind, 'file', '非法 kind 被纠正…')
        assert.match(r.warnings[0], /sheet/, '…且纠正被回吐')
    })
    test('intake 结构失败 ⇒ success:false 带 state/failedAt/compensations（模型能看见系统记到哪一步）', async () => {
        const runIntake = async () => ({ok: false, artifactCode: 'art-1', state: 'rolled-back', failedAt: 'uploaded', compensations: ['delete-doc-api-file']})
        const r = parse(await executeSaveArtifactTool({toolCall: toolCall({path: '/workspace/a'}), context: CTX, runIntake, genCode: (p) => `${p}-1`, ...ON}))
        assert.equal(r.success, false)
        assert.equal(r.data.state, 'rolled-back')
        assert.deepEqual(r.data.compensations, ['delete-doc-api-file'])
    })
    test('runIntake 抛 ⇒ 兜住成 success:false（编排的"不抛契约"在工具面再兜一层）', async () => {
        const r = parse(await executeSaveArtifactTool({toolCall: toolCall({path: '/workspace/a'}), context: CTX, runIntake: async () => { throw new Error('意外的抛') }, genCode: (p) => `${p}-1`, ...ON}))
        assert.equal(r.success, false)
        assert.match(r.error, /意外的抛/)
    })
})

describe('5 纯件纪律', () => {
    test('只依赖 intakeErrors；无网络/库/全局', () => {
        const src = fs.readFileSync(path.join(SRC, 'services/core/artifact/saveArtifactTool.js'), 'utf8')
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
        assert.deepEqual(imports, ['./intakeErrors.js'], `纯件只准依赖错误码：${JSON.stringify(imports)}`)
        assert.ok(!/fetch\(|mongoose|llm\.config/.test(code), '配置/编排全走参数注入，不读全局')
    })
})
