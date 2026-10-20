import { test } from 'node:test'
import * as assert from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, '../..')

/* 该模块在加载期读取 llm.logger / llm.config，故先注入最小全局再动态导入 */
global.llm = global.llm || {
  baseDir: srcDir + path.sep,
  logger: {info() {}, warn() {}, error() {}},
  config: {debug: false},
  tools: {},
}

const {LocalSkillProvider} = await import('../../skill/providers/localSkillProvider.js')

function makeProvider() {
  const p = new LocalSkillProvider()
  p.skillsIndex.set('document-extractor', {
    name: 'document-extractor',
    path: path.join(p.skillsDir, p.skillsSubDir, 'document-extractor'),
  })
  p.initialized = true
  return p
}

test('skillsIndex 未注册的 skill 被拒绝执行', () => {
  const p = makeProvider()
  assert.throws(
      () => p.assertScriptPath('evil', path.join(p.skillsDir, p.skillsSubDir, 'evil', 'scripts', 'index.js')),
      /未注册/
  )
})

test('路径越界被拒绝（含 .. 回溯与绝对路径逃逸）', () => {
  const p = makeProvider()
  const escape = path.resolve(srcDir, '..', '..', 'windows', 'system32', 'evil.js')
  assert.throws(() => p.assertScriptPath('document-extractor', escape), /越界/)

  const traversal = path.join(p.skillsDir, p.skillsSubDir, 'document-extractor', '..', '..', '..', 'app.js')
  assert.throws(() => p.assertScriptPath('document-extractor', traversal), /越界/)
})

test('正常 skill 路径通过校验', () => {
  const p = makeProvider()
  const ok = path.join(p.skillsDir, p.skillsSubDir, 'document-extractor', 'scripts', 'index.js')
  assert.doesNotThrow(() => p.assertScriptPath('document-extractor', ok))
})

test('executeCommand 对未注册 skill 抛出而非回退默认实现', async () => {
  const p = makeProvider()
  await assert.rejects(
      () => p.executeCommand({name: 'not-registered', path: path.join(p.skillsDir, p.skillsSubDir, 'not-registered')}, {name: 'x'}, {}),
      /未注册/
  )
})

test('executeCommand 对越界 path 抛出而非回退默认实现', async () => {
  const p = makeProvider()
  const outside = path.resolve(srcDir, '..')
  await assert.rejects(
      () => p.executeCommand({name: 'document-extractor', path: outside}, {name: 'x'}, {}),
      /越界|ENOENT/
  )
})
