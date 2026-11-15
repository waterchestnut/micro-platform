/**
 * @fileOverview llmChat 的"档案字段两截链"守卫（persistTurn 生产侧 vs saveMessage 落库白名单）
 * @module test/services/core/llmChatExtInfoWhitelist
 * @description
 * 2026-11-15 实锤链：answer_ack 的档案面在 persistTurn 加了键、saveMessage 的 extInfo **枚举白名单**
 * 忘了加 ⇒ 生产侧算好的值被静默丢弃，第一跑 `archiveAwaitings:false` 才暴露。
 * 这条链的每次"加档案字段"都要动两处——靠记性必漂移，所以做**通用集合差断言**：
 * persistTurn 递给 saveMessage 的 bundle 顶层键，必须全部出现在 saveMessage 的 extInfo/顶层落库枚举里；
 * 少一个就红，红的信息直接点名缺哪个键。
 * 形态是源码锚（同 artifactSchema/planWiring 家族）：llmChat 模块顶层依赖重，离线 import 不现实，
 * 而这条守卫审的恰好就是**源码结构本身**——锚在这里不是妥协，是对题。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/llmChat.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const src = fs.readFileSync(path.join(SRC, 'services/core/llmChat.js'), 'utf8').replace(/\r/g, '')

function braceBlock(from, openIdx) {
    const b = from.indexOf('{', openIdx)
    if (b < 0) {
        throw new Error('找不到起始花括号')
    }
    let depth = 0
    let inStr = null
    let inLine = false
    let inBlock = false
    for (let i = b; i < from.length; i++) {
        const ch = from[i]
        const next = from[i + 1]
        if (inLine) {
            if (ch === '\n') inLine = false
            continue
        }
        if (inBlock) {
            if (ch === '*' && next === '/') {
                inBlock = false
                i++
            }
            continue
        }
        if (inStr) {
            if (ch === '\\') i++
            else if (ch === inStr) inStr = null
            continue
        }
        if (ch === '/' && next === '/') {
            inLine = true
            i++
            continue
        }
        if (ch === '/' && next === '*') {
            inBlock = true
            i++
            continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch
            continue
        }
        if (ch === '{') depth++
        else if (ch === '}') {
            depth--
            if (depth === 0) return from.slice(b + 1, i)
        }
    }
    throw new Error('花括号不配对')
}

/** 取对象块顶层的 key: 列表——带注释/字符串状态机（注释里的反引号会被裸扫描当成串边界，0aadf88 守卫第一版就这么瞎过） */
function topLevelKeys(body) {
    const keys = new Set()
    let depth = 0
    let inStr = null
    let inLine = false
    let inBlock = false
    for (let i = 0; i < body.length; i++) {
        const ch = body[i]
        const next = body[i + 1]
        if (inLine) {
            if (ch === '\n') {
                inLine = false
            }
            continue
        }
        if (inBlock) {
            if (ch === '*' && next === '/') {
                inBlock = false
                i++
            }
            continue
        }
        if (inStr) {
            if (ch === '\\') {
                i++
            } else if (ch === inStr) {
                inStr = null
            }
            continue
        }
        if (ch === '/' && next === '/') {
            inLine = true
            i++
            continue
        }
        if (ch === '/' && next === '*') {
            inBlock = true
            i++
            continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch
            continue
        }
        if (ch === '{' || ch === '(' || ch === '[') {
            depth++
            continue
        }
        if (ch === '}' || ch === ')' || ch === ']') {
            depth--
            continue
        }
        if (depth === 0) {
            const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i, i + 64))
            if (m && (i === 0 || /[\n,]\s*$/.test(body.slice(0, i).slice(-64)))) {
                keys.add(m[1])
                i += m[0].length - 1
            }
        }
    }
    return keys
}

/** 块内**任意深度**点过的 `key:` 集合（顶层列判定用；仍避开注释与字符串） */
function allKeyTokens(body) {
    const keys = new Set()
    let inStr = null
    let inLine = false
    let inBlock = false
    for (let i = 0; i < body.length; i++) {
        const ch = body[i]
        const next = body[i + 1]
        if (inLine) {
            if (ch === '\n') inLine = false
            continue
        }
        if (inBlock) {
            if (ch === '*' && next === '/') {
                inBlock = false
                i++
            }
            continue
        }
        if (inStr) {
            if (ch === '\\') i++
            else if (ch === inStr) inStr = null
            continue
        }
        if (ch === '/' && next === '/') {
            inLine = true
            i++
            continue
        }
        if (ch === '/' && next === '*') {
            inBlock = true
            i++
            continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch
            continue
        }
        const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i, i + 64))
        if (m && (i === 0 || /[^\w$.]/.test(body[i - 1])) && !/[=:!<>&|+\-*/]\s*$/.test(body.slice(Math.max(0, i - 2), i))) {
            keys.add(m[1])
            i += m[0].length - 1
        }
    }
    return keys
}

describe('1 两截链守卫：每个 saveMessage 调用点的 bundle ⊆ 落库枚举', () => {
    test('saveMessage 的 extInfo/顶层枚举覆盖**所有调用点**递出的每一个档案键（漏一个=静默丢，0aadf88 的教训）', () => {
        // 消费侧：saveMessage 函数体内的 extInfo 字面量 + 直接落库的顶层键
        const fnIdx = src.indexOf('function saveMessage')
        assert.ok(fnIdx > 0, '找不到 saveMessage 定义')
        const fnBody = braceBlock(src, src.indexOf('{', fnIdx + 'function saveMessage'.length))
        const extIdx = fnBody.indexOf('extInfo: {')
        assert.ok(extIdx > 0, 'saveMessage 里找不到 extInfo 字面量')
        const extKeys = topLevelKeys(braceBlock(fnBody, extIdx + 'extInfo:'.length))
        // 覆盖集 = extInfo 白名单键 ∪ 函数体内**任意深度**点名的键（messageTokens 等走顶层列，不进 extInfo）
        const fnTop = allKeyTokens(fnBody)

        // 生产侧：**所有**调用点（主 persistTurn、缓存命中支……）的最后一个对象参数都算 bundle
        const bundleKeys = new Set()
        let callCount = 0
        let cursor = 0
        for (;;) {
            const callIdx = src.indexOf('saveMessage(', cursor)
            if (callIdx < 0) {
                break
            }
            cursor = callIdx + 5
            if (/\bfunction\s*$/.test(src.slice(Math.max(0, callIdx - 12), callIdx))) {
                continue // 定义行本身（async function saveMessage(）
            }
            // 找调用参数：从 '(' 起按状态机扫到配对 ')'，取最后一个顶层对象参数（`...options` 展开支跳过——
            // 它的键集就是主 bundle，靠 spread 语义共享同一份白名单）
            const pOpen = src.indexOf('(', callIdx)
            let depth = 1
            let inStr2 = null
            let inLine2 = false
            let inBlock2 = false
            let lastComma = pOpen
            let pClose = -1
            for (let j = pOpen + 1; j < src.length && depth > 0; j++) {
                const ch = src[j]
                const nx = src[j + 1]
                if (inLine2) {
                    if (ch === '\n') inLine2 = false
                    continue
                }
                if (inBlock2) {
                    if (ch === '*' && nx === '/') {
                        inBlock2 = false
                        j++
                    }
                    continue
                }
                if (inStr2) {
                    if (ch === '\\') j++
                    else if (ch === inStr2) inStr2 = null
                    continue
                }
                if (ch === '/' && nx === '/') {
                    inLine2 = true
                    j++
                    continue
                }
                if (ch === '/' && nx === '*') {
                    inBlock2 = true
                    j++
                    continue
                }
                if (ch === '"' || ch === "'" || ch === '`') {
                    inStr2 = ch
                    continue
                }
                if (ch === '(' || ch === '{' || ch === '[') depth++
                else if (ch === ')' || ch === '}' || ch === ']') depth--
                else if (ch === ',' && depth === 1) lastComma = j
                if (depth === 0) pClose = j
            }
            assert.ok(pClose > 0, `调用点 ${callIdx} 参数不配对`)
            const lastArg = src.slice(lastComma + 1, pClose).trim()
            if (!lastArg.startsWith('{')) {
                continue // 命名参数/展开——没有 bundle 对象
            }
            const body = braceBlock(lastArg, 0)
            const ks = topLevelKeys(body)
            assert.ok(ks.size >= 1, `调用点 ${callIdx} 的 bundle 解析为空`)
            for (const k of ks) {
                bundleKeys.add(k)
            }
            callCount++
        }
        assert.ok(callCount >= 2, `只解析到 ${callCount} 个调用点——守卫覆盖面缩水，先修解析`)
        assert.ok(bundleKeys.size > 15, `bundle 键数异常(${bundleKeys.size})，解析可能失效——守卫要修，不许假绿`)

        const missing = [...bundleKeys].filter((k) => !extKeys.has(k) && k !== 'extInfo' && !fnTop.has(k))
        assert.deepEqual(missing, [],
            `这些档案键在 saveMessage 调用点生产了、落库枚举里没有（会被静默丢弃）：${JSON.stringify(missing)}`)
        // 反向也钉：白名单里点名的审计键不许哪天被单边删掉
        assert.ok(extKeys.has('awaitings'), 'awaitings 必须在落库枚举里（P-19 档案面）')
        assert.ok(extKeys.has('steerings'), 'steerings 必须在落库枚举里（PR-D 审计面）')
    })
})
