/**
 * @fileOverview 路由层日志归属守卫（P8 的直接产物）
 * @module test/routes/streamErrorAttribution
 * @description
 * 起因是可核对的两件事：routes/core/chat/root.js 的 stream catch 原先写 console.error(err)，
 * 而本仓 logger 并不接管 console（搜不到 console.error = / globalThis.console 之类改写），
 * 于是那一行既没有 reqId、也没有 messageCode / conversationCode ——
 * 母本 dev 库里 126 个"有会话、无消息"的残留因此没有任何可对账的线索；同一行在本仓也存在，故两侧一起改。
 * 那不是"日志留存期过了"，而是"从来没写过可归属的日志"，所以这几条都该钉住：
 *
 * 1. routes 下不许出现会执行的 console 调用：路由是请求归属的边界，
 *    一旦允许裸 console，就会出现"日志存在但无法归到某一次请求"的形状——
 *    本文已多次用同一条判据（归属不明的日志不能作为证据），这次轮到它约束旧代码。
 * 2. stream 的 catch 必须用 request.log.error 并带上 messageCode / conversationCode：
 *    这是修复本身，防的是"有人图省事改回 console"。
 * 3. 同一个 catch 必须仍然 emit error 帧：我改的是日志，不是行为；
 *    如果哪天这段变成"只记日志不给用户反馈"，界面就会出现无提示的空白，那是另一个缺陷。
 * 4. logger 的配置不许把 messageCode / conversationCode / reqId 加进 redact：
 *    这一条守的是前三条的前提。字段被 redact 掉时，代码还在、调用还在、断言还全绿，
 *    只是读的人永远看不到归属——那正是 P8 那批残留的形状，换了个位置重演。
 *
 * 局限（写在这是为了让读守卫的人知道它守不到哪）：codeOf 只按行首判定注释行，
 * 行尾被块注释包住的调用靠一次"该行含块注释起始符则跳过"来排除；
 * 本守卫的目的是"别新增裸 console、别把归属改没"，不是做完整静态分析。
 */

import {test} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * @description 递归收集 .js 文件
 * @param {String} dir 目录
 * @returns {String[]} 文件列表
 */
function walk(dir) {
    const out = []
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name)
        const st = fs.statSync(p)
        if (st.isDirectory()) out.push(...walk(p))
        else if (/\.js$/.test(name)) out.push(p)
    }
    return out
}

/**
 * @description 读文件并按行去掉"行首就是注释"的行；返回 [原始行号, 文本]，
 *              这样守卫报出来的位置能直接跳到源码，不会因过滤而错位
 * @param {String} rel 相对 src 的路径
 * @returns {Array<Number|String>[]} 行数组
 */
function codeOf(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8')
        .replace(/\r/g, '')
        .split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => !/^\s*(\*|\/\/|\/\*)/.test(l.trim()))
}

const CONSOLE_RE = /\bconsole\.(log|info|warn|error|debug)\s*\(/
/** 块注释起始符：出现即认为该行的 console 是被人注释掉的，不算活代码 */
const BLOCK_COMMENT_OPEN = String.fromCharCode(47, 42)

test('routes 下不许出现会执行的 console 调用（归属必须来自 logger）', () => {
    const files = walk(path.join(SRC, 'routes'))
    assert.ok(files.length > 10, '路由文件数异常：' + files.length + '，扫描大概率跑偏了')
    const bad = []
    for (const f of files) {
        const rel = path.relative(SRC, f).split(path.sep).join('/')
        for (const [no, l] of codeOf(rel)) {
            if (!CONSOLE_RE.test(l)) continue
            if (l.includes(BLOCK_COMMENT_OPEN)) continue
            bad.push(rel + ':' + no + ' ' + l.trim().slice(0, 60))
        }
    }
    assert.deepEqual(bad, [], '路由里出现裸 console（这些行不带 reqId/messageCode，等于没写日志）：' + JSON.stringify(bad))
})

/**
 * @description 从某行起向下取一段代码
 * @param {Array<Number|String>[]} lines 行数组
 * @param {Number} from 起始下标
 * @param {Number} span 行数
 * @returns {String} 该段代码
 */
function sliceFrom(lines, from, span = 34) {
    return lines.slice(from, from + span).map(([, l]) => l).join('\n')
}

test('stream 的 catch 用 request.log.error，且必须带 messageCode 与 conversationCode', () => {
    const lines = codeOf('routes/core/chat/root.js')
    /** 定位法：先找 emit error 帧那一行，再回溯它所属的 catch——比按行号猜稳 */
    const emitIdx = lines.findIndex(([, l]) => /channel\.emit\([^)]*'error'\)/.test(l))
    assert.ok(emitIdx >= 0, '找不到 emit error 帧：路由结构变了，本守卫要跟着重写而不是跳过')
    let catchAt = -1
    for (let i = emitIdx; i >= 0; i--) {
        if (/^\s*\} catch \(err\) \{/.test(lines[i][1])) {
            catchAt = i
            break
        }
    }
    assert.ok(catchAt >= 0, 'emit error 帧不在 catch(err) 里：判定前提不成立，别拿本守卫的结果下结论')
    const body = sliceFrom(lines, catchAt)
    assert.match(body, /request\.log\.error\(/, 'catch 没走 request.log：日志会失去 reqId 归属')
    assert.match(body, /messageCode:/, 'catch 的日志没带 messageCode：无法对到档案行（P8 的病根，判据见母本 docs/ux-process-panel-audit.md）')
    assert.match(body, /conversationCode:/, 'catch 的日志没带 conversationCode：无法对到会话')
})

test('改了日志不许动行为：同一个 catch 仍要 emit error 帧给前端', () => {
    const lines = codeOf('routes/core/chat/root.js')
    const i = lines.findIndex(([, l]) => /request\.log\.error\(/.test(l))
    assert.ok(i >= 0, '找不到 request.log.error：修复被移除了')
    const around = lines.slice(Math.max(0, i - 6), i + 20).map(([, l]) => l).join('\n')
    assert.match(around, /errored\s*=\s*true/, 'errored 标记丢了：续接侧的终结状态会与实发不一致')
    assert.match(around, /channel\.emit\([^)]*'error'\)/, 'error 帧没发出去：用户会看到无提示的空白')
})

/**
 * 第 4 条守的是上面三条的前提，也是最容易被无声破坏的一条。
 *
 * 这次改动的全部价值在于"归属字段会出现在日志行里"，而那件事并不由我写的代码单独决定：
 * pino 的 redact 可以在不报错的情况下把 messageCode / conversationCode / reqId 抹成 [Redacted]。
 * 真发生那种事，前 3 条断言一条都不会红——代码还在、调用还在、字段还在源文里，
 * 只是**永远不会出现在读的人眼前**。这正是 P8 那 126 例的成因形状，只是换了个位置。
 *
 * 所以这里刻意不去禁止 redaction 本身（那是防泄密的正当手段，挡它就是帮倒忙），
 * 只钉住"redact 的范围不许盖到这三个归属字段"。
 */
test('logger 的配置不许把归属字段 redact 掉（否则第 2 条守的是空气）', () => {
    const rel = 'logger/index.js'
    assert.ok(fs.existsSync(path.join(SRC, rel)), '找不到 ' + rel + '：logger 装配方式变了，本守卫要跟着重写')
    const text = codeOf(rel).map(([, l]) => l).join('\n')
    const ATTR = ['messageCode', 'conversationCode', 'reqId']
    const offenders = []
    const re = /redact\s*:/g
    let m
    while ((m = re.exec(text)) !== null) {
        /** 取 redact 之后一段作为其取值范围；只在这段里查归属字段，别把无关的 redact 也判成违规 */
        const scope = text.slice(m.index, m.index + 600)
        for (const k of ATTR) {
            if (scope.includes(k)) offenders.push('redact 覆盖了 ' + k)
        }
    }
    assert.deepEqual(offenders, [], '归属字段被 redact ⇒ chat/stream 的错误日志会退化成无归属输出（P8 的病根）：' + JSON.stringify(offenders))
})


