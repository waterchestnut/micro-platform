import { test } from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {checkSelfContained, buildSkillBundle, parseBundleResult, HARNESS, RESULT_MARK} from '../../tools/skillBundle.js'

const SKILLS_DIR = path.resolve(process.cwd(), 'skill/skills')

test('仓库内所有 skill 脚本必须自包含（防止有人再把宿主模块 import 回来）', () => {
    const names = fs.readdirSync(SKILLS_DIR).filter(n => fs.existsSync(path.join(SKILLS_DIR, n, 'scripts', 'index.js')))
    assert.ok(names.length >= 2, `只找到 ${names.length} 个 skill 脚本，检查可能失效`)
    for (const name of names) {
        const src = fs.readFileSync(path.join(SKILLS_DIR, name, 'scripts', 'index.js'), 'utf8')
        const ret = checkSelfContained(src)
        assert.equal(ret.ok, true, `${name} 不能进沙箱：${JSON.stringify(ret.violations)}`)
    }
})

/** 真实跑一遍生成的包：证明 harness 协议、引号处理、错误路径在真 node 下成立 */
const SCRIPT = [
    "export async function executeCommand(name, params) {",
    "  if (name === 'boom') throw new Error('故意的失败分支')",
    "  return {name, url: params.url, host: process.env.SKILL_HOST_BASE || '', tok: (process.env.SKILL_CAP_TOKEN || '').slice(0, 4), extra: params.extra}",
    "}",
].join('\n')

function runBundle(over) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-'))
    const dir = path.join(root, 'work')
    const bundle = buildSkillBundle({dir, ...over})
    fs.mkdirSync(dir, {recursive: true})
    for (const f of bundle.files) fs.writeFileSync(f.path, Buffer.from(f.b64, 'base64'))
    try {
        const stdout = execFileSync('node', [path.join(dir, 'harness.mjs')], {
            cwd: dir, encoding: 'utf8',
            env: {...process.env, ...(over.env || {})},
        })
        return parseBundleResult(stdout)
    } finally {
        fs.rmSync(root, {recursive: true, force: true})
    }
}

test('harness 真执行：走 executeCommand 入口，参数原样送达', () => {
    const ret = runBundle({
        scriptText: SCRIPT,
        commandName: 'extractFromPdf',
        parameters: {url: "http://x/a.pdf?tag='q1'&v=2", extra: {n: 1, s: '中文'}},
        env: {SKILL_HOST_BASE: 'http://host:80', SKILL_CAP_TOKEN: 'body-sign'},
    })
    assert.equal(ret.ok, true, JSON.stringify(ret))
    assert.equal(ret.result.url, "http://x/a.pdf?tag='q1'&v=2", '带单引号的参数不能被 shell 或 JSON 撕坏')
    assert.deepEqual(ret.result.extra, {n: 1, s: '中文'})
    assert.equal(ret.result.host, 'http://host:80')
    assert.equal(ret.result.tok, 'body')
})

test('harness 真执行：skill 抛错也返回可解析的失败，不吐堆栈', () => {
    const ret = runBundle({scriptText: SCRIPT, commandName: 'boom', parameters: {}})
    assert.equal(ret.ok, false)
    assert.match(ret.error, /故意的失败分支/)
})

test('harness 真执行：没有 executeCommand 时回落具名导出', () => {
    const onlyNamed = "export async function namedOnly(params) { return {viaNamed: true, a: params.a} }"
    const ret = runBundle({scriptText: onlyNamed, commandName: 'namedOnly', parameters: {a: 7}})
    assert.equal(ret.ok, true, JSON.stringify(ret))
    assert.equal(ret.result.viaNamed, true)
    assert.equal(ret.result.a, 7)
})

test('harness 真执行：两个入口都没有时报明确错误', () => {
    const ret = runBundle({scriptText: 'export const x = 1', commandName: 'whatever', parameters: {}})
    assert.equal(ret.ok, false)
    assert.match(ret.error, /导出/)
})

test('harness 文本自带结果标记，改标记要同步 parseBundleResult', () => {
    assert.ok(HARNESS.includes(RESULT_MARK), 'harness 与解析器共用同一标记常量')
})
