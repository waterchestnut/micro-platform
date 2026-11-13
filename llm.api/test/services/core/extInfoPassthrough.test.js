import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * extInfo 的"两侧齐"不变量。
 *
 * 起因是 2026-11-13 的一次真实漏接：`runOverlap`（P5）与 `regeneratedFrom`（P3）
 * 在 `persistTurn` 里算好了、`messageView` 也承诺要透出、接线测试全绿，
 * 但**打到本地服务再读库，两个键根本不存在**——因为 `saveMessage` 里的 extInfo 是一份
 * 显式装配清单，我没往里加。源码级守卫只看了一侧，于是"看起来接好了"。
 *
 * 这条测试把两侧对起来：视图承诺的每一个键，装配清单里必须有来源。
 * 它不看我改了什么，它看的是"承诺与出口是否一致"——那才是这类 bug 的共同形状。
 */

/** 本文件在 src/test/services/core/ ⇒ 回到 src 需要上跳三级 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
/**
 * @description 读代码行（去 CR、去注释）
 * @param {String} rel 相对 src 路径
 * @returns {String[]} 行
 */
function codeOf(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l.trim()))
}

/**
 * @description 从 `extInfo: {` 起按花括号配对取出键集
 * @param {String[]} lines 代码行
 * @returns {String[]} 键
 */
function extInfoKeysFrom(lines) {
    const start = lines.findIndex((l) => /extInfo:\s*\{/.test(l))
    assert.ok(start >= 0, '找不到 extInfo 装配清单（llmChat 形状变了，本文件要重写而不是跳过）')
    const keys = []
    let depth = 0
    for (let i = start; i < lines.length; i++) {
        const l = lines[i]
        if (depth === 1) {
            const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(l)
            if (m) {
                keys.push(m[1])
            }
        }
        for (const ch of l) {
            if (ch === '{') depth += 1
            else if (ch === '}') depth -= 1
        }
        if (depth === 0 && i > start) break
    }
    return keys
}

/**
 * 视图侧的键清单直接取 `messageView.test.js` 里那份快照常量。
 * 不再自己解析函数体：上一版按缩进抓对象，抓到了顶层视图对象（`messageCode`/`channel` 那一层），
 * 于是"解析失败"伪装成"契约缺键"。用现成的权威清单比再造一个解析器可靠。
 */
function viewKeys() {
    const lines = codeOf('test/services/core/messageView.test.js')
    const joined = lines.join('\n')
    const m = /const DEV_MEASURED_PROCESS_KEYS\s*=\s*\[([\s\S]*?)\]/.exec(joined)
    assert.ok(m, '找不到 DEV_MEASURED_PROCESS_KEYS 快照常量（那份测试的形状变了，本文件要跟着重写）')
    return (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1))
}

/**
 * 视图键允许没有同名装配项的情况：值由别的字段**派生**出来。
 * 每一项都必须写清来源，否则这张表就会变成"什么都可以说不算漏"的漏洞。
 */
const DERIVED_VIEW_KEYS = {
    /** 由 extInfo.toolOverflows 派生（只给量级，不给 content） */
    toolResults: 'toolOverflows',
    /** 由 extInfo.answerList 现场算段数（messageView: `answerRounds: (info.answerList || []).length`） */
    answerRounds: 'answerList',
}

/**
 * 不走 `saveMessage` 装配清单、由别的写入路径直接落到 extInfo 的键。
 * 每一项都必须在那条路径的源码里真的写得到，否则就是"视图承诺了一个没人写的字段"。
 */
const OTHER_WRITER_KEYS = {
    /** 遗弃回填路径写的（`session/abandonedBackfill.js`）；普通轮次没有这个字段是设计如此 */
    lostChars: 'services/core/session/abandonedBackfill.js',
}

/**
 * @description 某个键是否在指定文件里作为字段被写出来
 * @param {String} key 键名
 * @param {String} rel 相对 src 路径
 * @returns {Boolean} 结果
 */
function writtenIn(key, rel) {
    return codeOf(rel).some((l) => l.trim().startsWith(`${key}:`))
}

/**
 * 装配清单里允许"不是字面透传"的例外：值必须是**某个纯归一函数对 options 的产物**，
 * 而且这里要写清函数名与所在模块，测试会去那个模块确认真的导出了它。
 * 为什么要这么严：「派生」与「凭空造字段」的差别只在于能不能查到一个源头；
 * 一张不附来源的例外表，三个月后就会变成什么都敢往里塞的后门。
 */
const DERIVED_ASSEMBLY_KEYS = {
    cache: {prefix: 'cacheIntent.', via: 'cacheIntentForArchive', module: 'services/core/session/cacheIntent.js'},
    channelCacheKey: {prefix: 'cacheIntent.', via: 'cacheIntentForArchive', module: 'services/core/session/cacheIntent.js'},
}

describe('extInfo 装配清单必须覆盖视图承诺的键', () => {
    const whitelist = extInfoKeysFrom(codeOf('services/core/llmChat.js'))
    const view = viewKeys()

    test('视图键集非空（解析失败时不能静默通过）', () => {
        assert.ok(view.length >= 15, `视图键只解析出 ${view.length} 个，解析大概率失效：${JSON.stringify(view)}`)
        assert.ok(whitelist.length >= 15, `装配清单只解析出 ${whitelist.length} 个：${JSON.stringify(whitelist)}`)
    })

    test('每个视图键要么在装配清单里，要么有可核对的派生来源或写入路径', () => {
        const missing = view.filter((k) => !whitelist.includes(k) && !DERIVED_VIEW_KEYS[k] && !OTHER_WRITER_KEYS[k])
        assert.deepEqual(missing, [],
            `视图承诺了这些键但装配清单没有 ⇒ 前端永远读到 null，而且没有任何地方报错：${JSON.stringify(missing)}`)
        for (const k of Object.keys(DERIVED_VIEW_KEYS)) {
            assert.ok(whitelist.includes(DERIVED_VIEW_KEYS[k]),
                `派生键 ${k} 声称来自 ${DERIVED_VIEW_KEYS[k]}，但装配清单里没有那个来源`)
        }
        for (const k of Object.keys(OTHER_WRITER_KEYS)) {
            assert.ok(writtenIn(k, OTHER_WRITER_KEYS[k]),
                `键 ${k} 声称由 ${OTHER_WRITER_KEYS[k]} 写，但那个文件里找不到它 ⇒ 视图承诺了一个没人写的字段`)
        }
    })

    test('P5/P3 两个新键必须在装配清单里（今天漏的就是它们）', () => {
        for (const k of ['runOverlap', 'regeneratedFrom']) {
            assert.ok(whitelist.includes(k), `装配清单缺 ${k} ⇒ 档案里读不到，界面与排查都无从依据`)
        }
    })

    test('装配清单里出现的每个键，落库前都必须是 options 的透传（不许凭空造字段）', () => {
        const lines = codeOf('services/core/llmChat.js')
        const start = lines.findIndex((l) => /extInfo:\s*\{/.test(l))
        const bad = []
        for (let i = start + 1; i < lines.length; i++) {
            const m = /^\s{12}([A-Za-z_$][\w$]*)\s*:\s*(.+?),?\s*$/.exec(lines[i])
            if (!m) {
                if (/^\s{8}\}/.test(lines[i])) break
                continue
            }
            if (/^options\./.test(m[2]) || /^[a-zA-Z_$][\w$.]*\.length$/.test(m[2])) {
                continue
            }
            /** 例外：纯归一函数的产物。要同时满足"前缀对得上、源头变量确实由 options 归一而来、模块真的导出那个函数" */
            const d = DERIVED_ASSEMBLY_KEYS[m[1]]
            if (d && m[2].startsWith(d.prefix)) {
                const declaresSource = lines.some((l) => new RegExp(`const ${d.prefix.slice(0, -1)}\\s*=\\s*${d.via}\\(`).test(l))
                if (!declaresSource) {
                    bad.push(`${m[1]}=${m[2].slice(0, 30)}（例外表说它来自 ${d.via}(options)，但 llmChat 里找不到这句）`)
                    continue
                }
                const mod = codeOf(d.module).join('\n')
                if (!new RegExp(`export function ${d.via}\\b`).test(mod)) {
                    bad.push(`${m[1]}=${d.via} 在 ${d.module} 里没有被导出 ⇒ 例外表已经过期`)
                    continue
                }
                continue
            }
            bad.push(`${m[1]}=${m[2].slice(0, 30)}`)
        }
        assert.deepEqual(bad, [], `装配清单里出现非透传值：${JSON.stringify(bad)}`)
    })

    /**
     * `cache` / `channelCacheKey` 是 2026-11-13 补进来的两个排查字段，单独钉一条：
     * 当时实测全库 1490 行里这两个键**一处都没有**，而"为什么没有"（白名单没列）只有在这种测试红掉时才会被再次发现。
     * 同时钉住**它们刻意不进视图**——落档不等于下发，下发要有人消费才有意义（`regeneratedFrom` 进 SSE 那次的反面教训）。
     */
    test('cache / channelCacheKey 必须在装配清单里，且刻意不出现在视图键集', () => {
        const whitelist = extInfoKeysFrom(codeOf('services/core/llmChat.js'))
        for (const k of ['cache', 'channelCacheKey']) {
            assert.ok(whitelist.includes(k), `装配清单缺 ${k} ⇒ 库里读不到"当时允不允许用缓存"，只能靠 answerFromCache 反推`)
        }
        const view = viewKeys()
        const leaked = ['cache', 'channelCacheKey'].filter((k) => view.includes(k))
        assert.deepEqual(leaked, [], '这两个键没有界面消费方，进视图只会多两个没人读的承诺')
    })
})
