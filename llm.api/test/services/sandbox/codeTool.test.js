import { test } from 'node:test'
import * as assert from 'node:assert'
import {
  CODE_TOOL_NAME,
  buildCodeTools,
  isCodeTool,
  codeToolEnabled,
  executeCodeTool,
} from '../../../services/sandbox/codeTool.js'
import {pickEnv} from '../../../services/sandbox/runner.js'

const call = (args, id = 'c1') => ({
  id,
  type: 'function',
  function: {name: CODE_TOOL_NAME, arguments: typeof args === 'string' ? args : JSON.stringify(args)},
})

test('工具定义要求 code 必填、语言枚举只放开 python/node', () => {
  const tools = buildCodeTools()
  assert.equal(tools.length, 1)
  const fn = tools[0].function
  assert.equal(fn.name, CODE_TOOL_NAME)
  assert.deepEqual(fn.parameters.required, ['code'])
  assert.deepEqual(fn.parameters.properties.lang.enum, ['python', 'node'])
  assert.ok(fn.description.includes('沙箱'), '描述要说清隔离边界，模型才知道不能塞凭据')
  assert.equal(isCodeTool(CODE_TOOL_NAME), true)
  assert.equal(isCodeTool('read_tool_result'), false)
})

test('开关关闭时不下发工具，也不执行', async () => {
  assert.equal(codeToolEnabled({}), false)
  assert.equal(codeToolEnabled({enabled: true}), true)
  assert.equal(codeToolEnabled({enabled: true, allowModelCode: false}), false, 'allowModelCode=false 是独立保险')
  const ret = await executeCodeTool({toolCall: call({code: 'print(1)'}), context: {conversationCode: 'c'}})
  assert.equal(ret.role, 'tool')
  const body = JSON.parse(ret.content)
  assert.equal(body.success, false, '测试环境没有 llm 全局，等同未开放')
  assert.match(body.error, /未开放/)
})

test('参数异常返回可读错误而不是抛断聊天循环', async () => {
  const bad = await executeCodeTool({toolCall: call('{坏 JSON'), context: {}})
  assert.match(JSON.parse(bad.content).error, /合法 JSON/)
  const empty = await executeCodeTool({toolCall: call({code: 'x'}), context: {}})
  assert.ok(['合法', '未开放', '会话'].some(k => JSON.parse(empty.content).error?.includes(k) || JSON.parse(empty.content).success === false))
})

test('env 白名单拦住凭据类键，只放行任务级前缀', () => {
  const kept = pickEnv({
    SANDBOX_MODE: '1', TASK_ID: 't-1', APP_NAME: 'x', SKILL_HOST_BASE: 'http://h',
    OPENAI_API_KEY: 'sk-secret', apiKey: 'x', LLM_RELAY_KEY: 'y', PATH: '/usr/bin',
  })
  assert.deepEqual(Object.keys(kept).sort(), ['APP_NAME', 'SANDBOX_MODE', 'SKILL_HOST_BASE', 'TASK_ID'])
  assert.equal(kept.OPENAI_API_KEY, undefined)
  assert.equal(kept.LLM_RELAY_KEY, undefined)
  assert.deepEqual(pickEnv(null), {})
})

// dev 实测契约：沙箱一律按 ESM 落盘，而模型很爱写 require()，会直接 ReferenceError
test('模型给的 CJS 代码按 cjs 落盘，ESM 代码按 mjs', async () => {
  const {pickNodeExt} = await import('../../../services/sandbox/runner.js')
  assert.equal(pickNodeExt('const http = require("node:http")\nhttp.get(x)'), 'cjs')
  assert.equal(pickNodeExt('module.exports = {a: 1}'), 'cjs')
  assert.equal(pickNodeExt('const p = __dirname + "/x"'), 'cjs')
  assert.equal(pickNodeExt('import fs from "node:fs"\nconsole.log(fs)'), 'mjs')
  assert.equal(pickNodeExt('export async function f() {}\nawait f()'), 'mjs')
  assert.equal(pickNodeExt('console.log(1)'), 'mjs')
  // 注释/字符串里提到 require( 不该把纯 ESM 无关键字的代码判成 cjs —— 但含 require( 即判 cjs，宁保守
  assert.equal(pickNodeExt('// 这里用 require() 的写法\nconsole.log(2)'), 'cjs')
  assert.equal(pickNodeExt('import a from "b"\nrequire("c")'), 'mjs')
})
