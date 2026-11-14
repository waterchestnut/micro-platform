/**
 * @fileOverview Fastify/ajv 选项守卫（§16.1 "ajv strictTypes 噪音" 待办的收口）
 * @module test/conf/appAjvOptions
 * @description
 * 待办要求"消掉启动期 10 条 `use allowUnionTypes` 噪音"。这一刀一路挖出**三处各自写死的 ajv 配置**，
 * 它们本该是同一份、实际已经漂移——这正是本仓反复说的"两套/多套并存"：
 *   ① `app.js` 导出的 `options.ajv.customOptions`（fastify-cli 走这条）
 *   ② `server.js` 内联 `Fastify({ajv:{customOptions}})`（**生产 pod 实跑 `node server.js` 走这条**）
 *   ③ `test/schemas/chatStreamSchema.test.js` 里 `new Ajv({...})`（自己 compile 一份 schema）
 * 只改 ① 会"测试日志干净了、线上照刷 10 条"；③ 更阴——它注释写着"与 app.js 保持一致"却自己漏了 flag，
 * 于是每次全量都刷 10 条，还让"测试用的 ajv ≠ 运行时的 ajv"这个它声称要防的事真的发生。
 *
 * 所以这道守卫钉两件事：
 * 1. **三处都开了 `allowUnionTypes`**；
 * 2. **三处的 ajv 选项集合逐项相等**（谁以后单独改一边、制造新漂移，立刻红）。
 *
 * 为什么读源码而不是 import app.js：
 * `import {options} from app.js` 会连带跑 `global.js` 里那句**未 await 的** `import('./extends/'+file)`，
 * 可能在后台拉起 DB/Redis 句柄——同一断言早先单测 50ms 过、三测版挂到超时，差别只是"连接是否已建立"的竞态。
 * 测试不依赖这种不确定，更不该靠 `--test-force-exit` 兜，所以用源码级断言（与 egressPosture 接线守卫同一手法）。
 * 锚点**限定在各配置块内并先剥注释**，否则别处或注释里的字样会让断言空转。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(dir, 'app.js')) && fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, 'services'))) {
            return dir
        }
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根（app.js/server.js 不在预期位置）')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (rel) => stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, ''))

/** 从 `{...}` 片段里抠 key: value 对 */
function pairsFrom(objText) {
    const pairs = {}
    for (const m of objText.matchAll(/(\w+)\s*:\s*([^,{}]+)/g)) {
        pairs[m[1]] = m[2].trim()
    }
    return pairs
}

/** ① ②：app.js / server.js 的 `customOptions: { ... }` */
function customOptionsOf(rel) {
    const src = read(rel)
    const at = src.indexOf('ajv:')
    assert.ok(at >= 0, `${rel} 里找不到 ajv 配置块`)
    const inner = src.indexOf('customOptions: {', at)
    assert.ok(inner > at, `${rel} 的 ajv 块里没有 customOptions`)
    const end = src.indexOf('}', inner)
    assert.ok(end > inner, `${rel} 的 customOptions 块没有闭合`)
    return pairsFrom(src.slice(inner + 'customOptions: {'.length, end))
}

/** ③：chatStreamSchema.test.js 的 `new Ajv({ ... })` */
function newAjvOf(rel) {
    const src = read(rel)
    const at = src.indexOf('new Ajv({')
    assert.ok(at >= 0, `${rel} 里找不到 new Ajv({...}) 构造`)
    const end = src.indexOf('})', at)
    assert.ok(end > at, `${rel} 的 new Ajv 调用没有正常闭合`)
    return pairsFrom(src.slice(at + 'new Ajv({'.length, end))
}

const EXPECTED = {removeAdditional: 'false', coerceTypes: 'true', allErrors: 'true', allowUnionTypes: 'true'}
const SITES = [
    {名: 'app.js options', 取值: () => customOptionsOf('app.js')},
    {名: 'server.js 内联(生产实跑)', 取值: () => customOptionsOf('server.js')},
    {名: 'chatStreamSchema.test.js new Ajv', 取值: () => newAjvOf('test/schemas/chatStreamSchema.test.js')},
]

describe('三处 ajv 配置必须一致（§16.1 消噪不得只改对一半）', () => {
    test('每处都开了 allowUnionTypes（含生产实跑的 server.js）', () => {
        for (const s of SITES) {
            assert.equal(s.取值().allowUnionTypes, 'true',
                `${s.名} 缺 allowUnionTypes:true ⇒ 这条路径会刷 10 条 strict 噪音，把 E0.2/E0.6 的真告警埋掉`)
        }
    })

    test('三处选项集合逐项相等（消噪是纯加性，且谁单独改一边就红）', () => {
        for (const s of SITES) {
            assert.deepEqual(s.取值(), EXPECTED,
                `${s.名} 的 ajv 选项偏离预期；若确属必要，请连同三处与 §16.1 待办一起更新，并说明改不改校验行为`)
        }
        // 再显式两两相等，让"漂移"这种失败模式的名字直接出现在断言信息里
        assert.deepEqual(customOptionsOf('app.js'), customOptionsOf('server.js'), 'app.js 与 server.js 漂移')
        assert.deepEqual(customOptionsOf('app.js'), newAjvOf('test/schemas/chatStreamSchema.test.js'), 'app.js 与 schema 测试漂移')
    })
})
