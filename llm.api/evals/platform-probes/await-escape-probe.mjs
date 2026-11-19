/**
 * @fileOverview await 逃逸探针（P8 的判定工具，只读）
 * @module evals/platform-probes/await-escape-probe
 * @description
 * 回答一个具体问题：**在会话记录已建、而消息档案还没落之间，哪些抛出会直接逃出 execChat？**
 * 逃出就意味着"有会话、无消息"——dev 库里实测过 126 例这样的残留（见 docs/ux-process-panel-audit.md 的 P8）。
 *
 * 为什么需要这个探针：同一个问题我用词法扫描答过四次，每次给出不同的**错**数字
 * （把辅助函数体内的 await 当成裸奔；只认 4 空格缩进的 try；把第一个 try 当主保护块；
 * 用缩进猜"是不是 execChat 线性流程"）。"某处 await 运行时受不受保护"是**控制流属性**，
 * 不是文本属性，只有按 AST 的祖先链判才对。所以这里刻意用真解析器，而不是再写一遍正则。
 *
 * 判据（按 ECMAScript 语义）：
 * - await 的抛出会被"祖先链上以 block 分支连接它的 TryStatement"的 handler 接住；
 *   handler / finalizer 里的 await 不算被同一个 try 保护自己；
 * - **定义在 execChat 里的函数**体内的 await，其保护由**调用点**决定 ——
 *   所以探针把"函数体内的裸 await"与"该函数的调用点是否受保护"成对打印，两者都裸才算逃逸路径；
 * - 没有 try 保护时抛出会直接离开 execChat，路由层的 catch 不落档案（P8 的另一半）。
 *
 * **本探针的边界，读结果前必须知道**：
 * 1. 只统计 `await`。同一区间里的**同步**调用（例如 `emitMeta` 在缓存命中分支那次调用）抛出同样会逃出，
 *    所以下面的数字是**逃逸点的下界**，不是全集；
 * 2. 不判断"抛出之后是否已有别的写入"。落库点由脚本单列（persistTurn / saveMessage 的调用点），
 *    要人工对齐到区间上再下结论；
 * 3. 不做可达性分析：某个函数虽然定义在 execChat 里，但只在优雅关闭路径被调，那它不算"正常轮次"的逃逸点。
 *
 * 依赖说明：解析器取的是 node_modules 里已有的 `@babel/parser`（当前经 jest 的 babel 传递进来），
 * **刻意没有加进 package.json**：加直接依赖就得同步 lock，而 `npm ci` 在两者不一致时会直接失败——
 * 不该让一个诊断工具进到部署路径里。取不到解析器时本探针**显式失败并给出安装命令**，不会静默出数。
 *
 * 用法：`node evals/platform-probes/await-escape-probe.mjs [目标llmChat.js路径]`
 * 输出只有行号与计数，不含正文、不含用户标识。
 */
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TARGET = process.argv[2] || path.join(SRC, 'services/core/llmChat.js')

const r = createRequire(path.join(SRC, 'server.js'))
let parse
try {
    parse = r('@babel/parser').parse
} catch (e) {
    try {
        parse = r('esprima').parseModule
    } catch (e2) {
        console.error('取不到 JS 解析器（@babel/parser 或 esprima）。本探针不许在没解析器的情况下出数。')
        console.error('装一个再跑：npm i -D @babel/parser')
        process.exit(2)
    }
}

const code = fs.readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n')
const ast = parse(code, {sourceType: 'module'})

/** 行号换算：偏移表 + 二分（每处都从头数换行符，在这个规模上会慢到没法复跑） */
const lineStarts = [0]
for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1)
const lineOf = (pos) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (lineStarts[mid] <= pos) lo = mid
        else hi = mid - 1
    }
    return lo + 1
}

/** 手写遍历：带祖先链，并且记住"我是通过父节点的哪个键接过来的"（判 try 的 block/handler 要用） */
const nodes = []
function visit(n, ancestors) {
    if (!n || typeof n !== 'object' || typeof n.type !== 'string') return
    nodes.push({node: n, ancestors})
    for (const k of Object.keys(n)) {
        if (['loc', 'start', 'end', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'extra', 'tokens'].includes(k)) continue
        const v = n[k]
        if (Array.isArray(v)) {
            for (const c of v) visit(c, [...ancestors, {node: n, key: k}])
        } else if (v && typeof v === 'object' && typeof v.type === 'string') {
            visit(v, [...ancestors, {node: n, key: k}])
        }
    }
}
visit(ast.program, [])

const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const inRange = (child, parent) => child.start >= parent.start && child.end <= parent.end

const execEntry = nodes.find((x) => FN.has(x.node.type) && x.node.id && x.node.id.name === 'execChat')
if (!execEntry) {
    console.error('找不到 execChat：文件结构变了，本探针的判据要跟着重写，不出数')
    process.exit(3)
}
const EX = execEntry.node
const body = EX.body

const ownerFn = (e) => {
    for (let i = e.ancestors.length - 1; i >= 0; i--) if (FN.has(e.ancestors[i].node.type)) return e.ancestors[i].node
    return null
}
/** 包住它的 try（只认 block 分支，且必须有 handler —— 没 handler 的 try 不吞异常） */
const protectors = (e) => e.ancestors
    .filter((a) => a.node.type === 'TryStatement' && a.key === 'block' && a.node.handler)
    .map((a) => [lineOf(a.node.block.start), lineOf(a.node.block.end)])
const nameOfFn = (fnNode) => {
    const e = nodes.find((x) => x.node === fnNode)
    if (!e) return '(匿名)'
    const p = e.ancestors[e.ancestors.length - 1]
    if (!p) return '(匿名)'
    if (p.node.type === 'VariableDeclarator' && p.node.id && p.node.id.name) return p.node.id.name
    if (p.node.type === 'ObjectProperty' || p.node.type === 'ClassMethod') {
        return (p.node.key && (p.node.key.name || p.node.key.value)) || String(p.key)
    }
    return String(p.key) + '(回调)'
}
const calleeLabel = (aw) => {
    const a = aw.node.argument
    if (!a) return '?'
    if (a.type === 'CallExpression') {
        const c = a.callee
        if (c && c.type === 'Identifier') return c.name
        if (c && c.type === 'MemberExpression' && c.property) {
            return ((c.object && c.object.name) || '?') + '.' + (c.property.name || c.property.value || '?')
        }
    }
    if (a.type === 'Identifier') return 'await ' + a.name + '(非调用)'
    return a.type
}
/** 会话创建那一行：`conversationDac.add(` 或 `conversationDac.add?.(` ——取 add 的调用点 */
const addSite = nodes.find((x) => x.node.type === 'CallExpression'
    && inRange(x.node, body)
    && x.node.callee && x.node.callee.type === 'MemberExpression'
    && x.node.callee.object && x.node.callee.object.name === 'conversationDac'
    && x.node.callee.property && x.node.callee.property.name === 'add')
/** 主保护块：包住工具循环的那个 try（按 while(...iterationCount...) 定位，不按行号猜） */
const loop = nodes.find((x) => x.node.type === 'WhileStatement'
    && inRange(x.node, body) && /iterationCount/.test(code.slice(x.node.test.start, x.node.test.end)))
const ownTrys = nodes.filter((x) => x.node.type === 'TryStatement' && inRange(x.node, body) && ownerFn(x) === EX)
const mainTryEntry = ownTrys.find((t) => loop && inRange(loop.node, t.node)) || ownTrys.slice().sort((a, b) => (b.node.end - b.node.start) - (a.node.end - a.node.start))[0]
if (!mainTryEntry) {
    console.error('找不到主保护块（execChat 本体的 try）：判据前提不成立，不出数')
    process.exit(4)
}
const MAIN_A = lineOf(mainTryEntry.node.block.start)
const ADD_L = addSite ? lineOf(addSite.node.start) : -1

/** 1) execChat 本体的 await：按"在主保护块之前/之后"与"有无保护"分开 */
const ownAwaits = nodes.filter((x) => x.node.type === 'AwaitExpression' && inRange(x.node, body) && ownerFn(x) === EX)
const ownBareBefore = ownAwaits.filter((x) => lineOf(x.node.start) < MAIN_A && protectors(x).length === 0)
const ownGuardedBefore = ownAwaits.filter((x) => lineOf(x.node.start) < MAIN_A && protectors(x).length > 0)
console.log(JSON.stringify({
    目标文件: path.relative(SRC, TARGET).split(path.sep).join('/'),
    execChat: [lineOf(EX.start), lineOf(body.end)],
    会话创建行: ADD_L,
    主保护块: MAIN_A + '-' + lineOf(mainTryEntry.node.block.end),
    本体await总数: ownAwaits.length,
    主保护块之前的本体await: ownAwaits.filter((x) => lineOf(x.node.start) < MAIN_A).length,
    其中无保护: ownBareBefore.length,
    其中有保护: ownGuardedBefore.length,
    无保护且在会话已建之后: ownBareBefore.filter((x) => lineOf(x.node.start) > ADD_L).length,
    嵌套函数数: nodes.filter((x) => FN.has(x.node.type) && inRange(x.node, body) && x.node !== EX).length,
}, null, 1))
console.log('=== execChat 本体、主保护块之前、**没有 try 包住**的 await（=抛出即离开 execChat）')
for (const x of ownBareBefore) {
    const l = lineOf(x.node.start)
    console.log('   L' + l + '  ' + calleeLabel(x) + '  ' + (l > ADD_L ? '[会话已建→可能留残留]' : '[会话尚未建]'))
}
console.log('=== 同区间内**有** try 包住的 await（对照用：别把整段说成裸奔）')
for (const x of ownGuardedBefore) {
    console.log('   L' + lineOf(x.node.start) + '  ' + calleeLabel(x) + '  被 ' + JSON.stringify(protectors(x)) + ' 包住')
}

/** 2) 深度1 函数：函数体内的裸 await × 调用点是否受保护，成对给出 */
console.log('=== 定义在 execChat 里的函数（深度1）：本体裸 await 与它的调用点')
const depth1 = nodes.filter((x) => FN.has(x.node.type) && inRange(x.node, body) && x.node !== EX
    && x.ancestors.filter((a) => FN.has(a.node.type)).length === 1)
for (const f of depth1) {
    const nm = nameOfFn(f.node)
    const bare = nodes.filter((y) => y.node.type === 'AwaitExpression' && inRange(y.node, f.node)
        && ownerFn(y) === f.node && protectors(y).length === 0).map((y) => lineOf(y.node.start))
    if (!bare.length) continue
    /** 调用点：整个 execChat 体内的同名调用（含嵌套内调用），各自是否受保护 */
    const sites = nodes.filter((x) => x.node.type === 'CallExpression' && inRange(x.node, body)
        && x.node.callee && x.node.callee.type === 'Identifier' && x.node.callee.name === nm)
        .map((x) => 'L' + lineOf(x.node.start) + (protectors(x).length ? '(受保护)' : '(裸)')
            + (ownerFn(x) === EX ? '' : '@' + nameOfFn(ownerFn(x))))
    console.log('   ' + nm + ' 定义' + lineOf(f.node.start) + '-' + lineOf(f.node.end)
        + ' 本体裸await=' + JSON.stringify(bare) + ' 调用点=' + JSON.stringify(sites)
        + (sites.some((s) => s.includes('(裸)')) ? '   ⇒ 有"体内裸 + 调用点裸"的组合' : '   ⇒ 调用点都受保护，体内抛出会被接住'))
}

/** 3) 落库点单列：判"残留窗口"的右边界要用它，不能让读的人去猜第一次写在哪 */
console.log('=== 落库调用点（persistTurn / saveMessage）')
for (const nm of ['persistTurn', 'saveMessage']) {
    const sites = nodes.filter((x) => x.node.type === 'CallExpression' && inRange(x.node, body)
        && x.node.callee && x.node.callee.type === 'Identifier' && x.node.callee.name === nm)
    for (const x of sites) {
        const o = ownerFn(x)
        console.log('   ' + nm + ' L' + lineOf(x.node.start)
            + (lineOf(x.node.start) < MAIN_A ? ' [主保护块之前]' : ' [主保护块之内]')
            + ' 归属=' + (o === EX ? 'execChat本体' : nameOfFn(o))
            + ' ' + (protectors(x).length ? '受保护' : '**裸**'))
    }
    if (!sites.length) console.log('   ' + nm + ' 调用点=0（这个文件里没有，别按母本的行号读它）')
}
console.log('=== 读法提醒：以上只算 await；同区间的**同步**调用抛出同样会逃出，所以这是逃逸点的**下界**')
process.exit(0)
