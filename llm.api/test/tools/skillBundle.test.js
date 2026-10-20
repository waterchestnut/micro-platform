import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  stripComments,
  checkSelfContained,
  buildSkillBundle,
  parseBundleResult,
  RESULT_MARK,
} from '../../tools/skillBundle.js'

test('stripComments 去注释但保留字符串', () => {
  assert.equal(stripComments("// import x from './a.js'\nconst b = 1").includes('import'), false)
  assert.ok(stripComments("/* import y from './b.js' */\nconst c = 2").includes('const c = 2'))
  /** 字符串里的 // 不能被当注释，否则后半行被吞、真实 import 会漏检 */
  const kept = stripComments("const url = 'http://a/b.pdf'\nconst n = 3")
  assert.ok(kept.includes('http://a/b.pdf'), kept)
  assert.ok(kept.includes('const n = 3'), kept)
})

test('checkSelfContained 抓相对/裸包名，放过 Node 内置', () => {
  assert.equal(checkSelfContained("import x from './rel.js'").ok, false)
  assert.equal(checkSelfContained("import grpc from '@grpc/grpc-js'").ok, false)
  assert.equal(checkSelfContained("const m = require('fs')").ok, true)
  assert.equal(checkSelfContained("import {readFileSync} from 'node:fs'\nimport os from 'os'").ok, true)
  assert.equal(checkSelfContained('').ok, true)
})

test('注释里的 import 不再被误判（这一条曾因误报而暴露真 bug）', () => {
  const src = [
    '/**',
    " * 旧版 import {pdf2Text} from '../../../../grpc/clients/extractor.js' 会把宿主模块拖进沙箱",
    ' */',
    "export async function executeCommand(n) { return {n} }",
  ].join('\n')
  assert.equal(checkSelfContained(src).ok, true, JSON.stringify(checkSelfContained(src).violations))
})

test('字符串里的 import 会被判违规：偏保守可接受，但必须是有意的取舍', () => {
  /** 检查器不解析 AST，模板字符串里的 import 片段会误报。 */
  const src = "const tpl = `import a from './t.js'`\nexport const y = 1"
  assert.equal(checkSelfContained(src).ok, false, '文档已说明：宁可误报也不漏报')
})

test('buildSkillBundle 生成四个文件与一条命令，参数不进命令行', () => {
  const b = buildSkillBundle({
    scriptText: "export async function executeCommand(n, p) { return {n, u: p.url} }",
    commandName: 'extractFromPdf',
    parameters: {url: "http://x/a.pdf?tag='q'"},
    hostBase: 'http://host:80/',
    token: 'tk.sig',
    dir: '/tmp/s1',
  })
  assert.deepEqual(b.files.map(f => f.path), [
    '/tmp/s1/skill.mjs', '/tmp/s1/params.json', '/tmp/s1/command.txt', '/tmp/s1/harness.mjs',
  ])
  assert.ok(b.command.startsWith('mkdir -p'), b.command.slice(0, 40))
  assert.ok(!b.command.includes("http://x/a.pdf"), '参数写进 params.json，不拼进命令行')
  assert.ok(b.command.includes('SKILL_HOST_BASE='))
  assert.ok(b.command.includes('SKILL_CAP_TOKEN='))
  assert.ok(b.command.includes('node '), '最后要执行 harness')
  /** base64 内容可还原 */
  const decoded = Buffer.from(b.files[1].b64, 'base64').toString('utf8')
  assert.equal(JSON.parse(decoded).url, "http://x/a.pdf?tag='q'")
})

test('buildSkillBundle 对空脚本与缺参报错，不产出半成品包', () => {
  assert.throws(() => buildSkillBundle({}), /scriptText/)
  const b = buildSkillBundle({scriptText: 'export const x=1'})
  assert.ok(b.dir.startsWith('/tmp/skill-'))
  assert.equal(JSON.parse(Buffer.from(b.files[1].b64, 'base64').toString()).constructor, Object)
})

test('parseBundleResult 覆盖命中/失败/无标记/坏 JSON 四态', () => {
  assert.deepEqual(parseBundleResult(`x\n${RESULT_MARK}{"ok":true,"result":{"a":1}}`), {ok: true, result: {a: 1}})
  assert.equal(parseBundleResult(`${RESULT_MARK}{"ok":false,"error":"boom"}`).error, 'boom')
  assert.equal(parseBundleResult('nothing here').ok, false)
  assert.match(parseBundleResult('nothing here').error, /结果标记/)
  assert.equal(parseBundleResult(`${RESULT_MARK}not json`).ok, false)
  assert.equal(parseBundleResult('').ok, false)
})
