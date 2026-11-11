import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

/**
 * `cron` 配置面的**完整性**断言：代码里读到的每一个 `cron` 键，配置面必须声明得出。
 *
 * 起因是本轮自己写下又自己违反的原则（`conf/system.config.js` 的 cron 块注释原话：
 * "有开关但在配置里找不到" 与 "配置写了不生效" 是同一类可运维性缺陷）。
 * 我给恢复功能摊出了 `recoverMode/Batch/StuckMs/MaxTimes/WindowMs`，
 * 却在 `cron/retention.js` 里读着 **`cronConfig.recoverEnabled` 与 `cronConfig.recoverPattern`**
 * 而配置面**根本没有这两个键**——也就是说"这个定时任务能不能关、多久跑一次"
 * 在配置文件里查不到，只能读代码。目视查过一遍还是漏了，所以把它变成测试。
 *
 * 这条测试只判"键在不在"，不判值——值由各部署自己定（底座模板就把默认设成关）。
 */

const SRC = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))

/**
 * @description 递归收集目录下的 .js 文件
 * @param {String} dir 目录
 * @returns {Array<String>} 文件列表
 */
function collect(dir) {
    if (!fs.existsSync(dir)) {
        return []
    }
    const out = []
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) {
            continue
        }
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
            out.push(...collect(p))
        } else if (e.name.endsWith('.js')) {
            out.push(p)
        }
    }
    return out
}

/**
 * @description 取 conf 里 cron 块的顶层键
 * @param {String} conf 配置源码
 * @returns {Array<String>} 键名
 */
function declaredCronKeys(conf) {
    const start = conf.indexOf('    cron: {')
    assert.ok(start > 0, '配置面里找不到 cron 块')
    let depth = 0
    let end = -1
    for (let i = conf.indexOf('{', start); i < conf.length; i++) {
        if (conf[i] === '{') {
            depth++
        } else if (conf[i] === '}') {
            depth--
            if (depth === 0) {
                end = i
                break
            }
        }
    }
    assert.ok(end > start, 'cron 块没有闭合')
    const block = conf.slice(start, end)
    const keys = new Set()
    /** 只认块首层缩进（8 空格）的 `key:`，否则会把子对象里的键也算进来 */
    for (const m of block.matchAll(/^\s{8}([A-Za-z_][A-Za-z0-9_]*):/gm)) {
        keys.add(m[1])
    }
    return [...keys]
}

const confSrc = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
const declared = declaredCronKeys(confSrc)

/** 读 cron 键的两种写法：`cronConfig.x` 与 `config.cron?.x` / `config.cron.x` */
const READ_PATTERNS = [
    /\bcronConfig\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /\bcronConfig\[['"]([^'"]+)['"]\]/g,
    /\bconfig\.cron\??\.([A-Za-z_][A-Za-z0-9_]*)/g,
]
const readers = []
for (const dir of ['cron', 'tasks', 'services', 'routes', 'plugins', 'daos']) {
    for (const f of collect(path.join(SRC, dir))) {
        const src = fs.readFileSync(f, 'utf8')
        const hits = new Set()
        for (const re of READ_PATTERNS) {
            re.lastIndex = 0
            for (const m of src.matchAll(re)) {
                hits.add(m[1])
            }
        }
        for (const k of hits) {
            readers.push({键: k, 出处: path.relative(SRC, f).replace(/\\/g, '/')})
        }
    }
}

describe('cron 配置面的键完整性（代码读得到、配置面也要看得见）', () => {
    test('至少扫到了读 cron 键的代码（扫描本身失效时不许假绿）', () => {
        assert.ok(readers.length >= 10,
            `只扫到 ${readers.length} 处 cron 键读取，多半是匹配式或目录写错了：${JSON.stringify([...new Set(readers.map(r => r.出处))])}`)
        assert.ok(declared.length >= 10, `配置面只解析出 ${declared.length} 个键，多半是块边界取错了`)
    })

    test('每一个被读的 cron 键都在配置面里声明', () => {
        const missing = readers.filter(r => !declared.includes(r.键))
        assert.deepEqual(missing, [],
            `这些键被代码读了、配置面却找不到（运维只能读代码才知道有开关）：\n`
            + missing.map(m => `  ${m.键} ← ${m.出处}`).join('\n'))
    })

    test('恢复相关的键都齐全（本轮实测证明"看不见"会直接导致功能空转没人发现）', () => {
        for (const k of ['recoverEnabled', 'recoverPattern', 'recoverMode', 'recoverBatch',
            'recoverStuckMs', 'recoverMaxTimes', 'recoverWindowMs']) {
            assert.ok(declared.includes(k), `配置面缺 ${k}`)
        }
    })

    test('执行租约也在配置面（它与 recoverStuckMs 是一对必须一起想的数）', () => {
        const confKeys = fs.readFileSync(path.join(SRC, 'conf/system.config.js'), 'utf8')
        assert.match(confKeys, /agentTask:\s*\{[\s\S]{0,1200}execLeaseMs:/, 'agentTask.execLeaseMs 必须看得见')
    })
})
