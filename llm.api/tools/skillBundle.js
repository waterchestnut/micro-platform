/**
 * @fileOverview 自包含 skill 脚本的沙箱执行包（构建与解析）
 * @module tools/skillBundle
 * @description 一个 skill 要能在沙箱里跑，前提是**它不依赖 llm.api 的内部模块**：
 * 旧写法 `import {pdf2Text} from '../../../../grpc/clients/extractor.js'` 会把 gRPC 客户端、
 * .proto、node_modules、llm.config 全拖进沙箱，那已经不叫"自包含"。
 * 所以这里定两条硬规矩并给可测的纯函数：
 *   1. 脚本只许 import Node 内置模块（fetch/URL/fs 等），相对路径与裸包名一律视为违规；
 *   2. 宿主能力通过 `process.env` 里的 host 地址 + 能力 token 反向调用 HTTP 获取。
 *
 * 传输方式刻意用最笨的一种：把文件 base64 内联进一条 shell 命令写入沙箱再执行。
 * 理由：不依赖 execd 的 multipart 上传细节，一条 /command 就够，且脚本内容是我们自己审过的。
 */

/** Node 内置模块（够 skill 用；不列出的一律按违规处理，宁严不松） */
export const NODE_BUILTINS = new Set([
    'fs', 'fs/promises', 'path', 'os', 'url', 'util', 'crypto', 'buffer', 'stream', 'string_decoder',
    'events', 'assert', 'child_process', 'worker_threads', 'cluster', 'http', 'https', 'net', 'dns',
    'tls', 'zlib', 'querystring', 'timers', 'v8', 'vm', 'tty', 'dgram', 'readline', 'repl', 'module',
    'perf_hooks', 'async_hooks', 'inspector', 'test', 'node:fs', 'node:path', 'node:os', 'node:url',
    'node:util', 'node:crypto', 'node:http', 'node:https', 'node:zlib', 'node:buffer', 'node:stream',
])

/** 结果分隔符：模型可能往 stdout 里打任何东西，靠标记定位而不是猜最后一行 */
export const RESULT_MARK = '__SKILL_BUNDLE_RESULT__'

/**
 * 匹配 import/export 说明符与 require 参数。
 * **刻意不要求前置边界字符**：早先版本用 `(?:^|[\s;{}])` 起头，结果
 * `` const t = `import a from './x.js'` `` 这种反引号后面的 import 直接漏检（假阴性）。
 * 注释已被 stripComments 去掉，所以放宽边界的代价只是"字符串里出现 import 字样会误报"，
 * 而误报方向是保守的（宁可多拦一层），漏报才是危险的。
 */
const IMPORT_RE = /(?:^|[^A-Za-z0-9_$.])(?:import|export)\s+(?:[^'"]*from\s*)?['"]([^'"]+)['"]/g
const REQ_RE = /(?:^|[^A-Za-z0-9_$.])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * @description 剥掉注释（保留字符串内容）
 *
 * 为什么需要：直接对原文跑正则会把**注释里提到 import 的说明文字**当成真实 import
 * （实测就踩了：新脚本头部注释写了"旧版 import {pdf2Text} from '../../../../grpc/...'"，
 * 于是被误判违规）。
 *
 * 为什么**不能**连字符串一起丢：import 说明符本身就是字符串，
 * 丢了检查器会"什么都看不见"从而永远通过——那比误报更危险。
 * 所以这里只处理注释，但扫描时仍要维护字符串状态，
 * 否则 `const url = 'http://a'` 里的 `//` 会被当成行注释把后半行吃掉。
 * @author xianyang
 * @param {String} source 源码
 * @returns {String} 去掉注释后的文本
 */
export function stripComments(source) {
    const text = String(source || '')
    let out = ''
    let i = 0
    while (i < text.length) {
        const c = text[i]
        const next = text[i + 1]
        if (c === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++
            }
            continue
        }
        if (c === '/' && next === '*') {
            i += 2
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                if (text[i] === '\n') {
                    out += '\n'
                }
                i++
            }
            i += 2
            continue
        }
        if (c === '"' || c === "'" || c === '`') {
            const quote = c
            out += c
            i++
            while (i < text.length) {
                if (text[i] === '\\') {
                    out += text[i] + (text[i + 1] ?? '')
                    i += 2
                    continue
                }
                out += text[i]
                if (text[i] === quote) {
                    i++
                    break
                }
                i++
            }
            continue
        }
        out += c
        i++
    }
    return out
}

/**
 * @description 检查脚本是否自包含（只 import Node 内置模块）
 * @author xianyang
 * @param {String} source 脚本源码
 * @returns {Object} {ok, violations:[{source, reason}]}
 */
export function checkSelfContained(source) {
    const text = stripComments(source)
    const violations = []
    const seen = new Set()
    const collect = (re, kind) => {
        let m
        re.lastIndex = 0
        while ((m = re.exec(text)) !== null) {
            const spec = m[1]
            const key = kind + ':' + spec
            if (seen.has(key)) {
                continue
            }
            seen.add(key)
            if (spec.startsWith('.') || spec.startsWith('/')) {
                violations.push({source: spec, reason: '相对/绝对路径 import 会把宿主源码树拖进沙箱'})
                continue
            }
            const bare = spec.startsWith('node:') ? spec : `node:${spec}`
            const isBuiltin = NODE_BUILTINS.has(spec) || NODE_BUILTINS.has(bare) || spec.startsWith('node:')
            if (!isBuiltin) {
                violations.push({source: spec, reason: '非 Node 内置模块（需自带 node_modules 或外部服务，不算自包含）'})
            }
        }
    }
    collect(IMPORT_RE, 'import')
    collect(REQ_RE, 'require')
    return {ok: violations.length === 0, violations}
}

/**
 * @description 生成执行包：要写进沙箱的文件 + 一条 shell 命令
 * @author xianyang
 * @param {Object} params 入参
 * @param {String} params.scriptText skill 脚本源码
 * @param {String} [params.commandName] 要调用的命令名（脚本里的 executeCommand 分支）
 * @param {Object} [params.parameters] 命令参数
 * @param {String} [params.dir] 沙箱内工作目录
 * @param {String} [params.hostBase] 宿主能力接口地址（如 http://llm-api-http.micro:80）
 * @param {String} [params.token] 能力 token
 * @param {Object} [params.env] 额外环境变量（只放业务参数，凭据走 token）
 * @returns {Object} {dir, files, command}
 */
export function buildSkillBundle(params = {}) {
    const dir = params.dir || `/tmp/skill-${Date.now().toString(36)}`
    const scriptText = String(params.scriptText || '')
    if (!scriptText.trim()) {
        throw new Error('buildSkillBundle 需要 scriptText')
    }
    const entry = params.entry || 'skill.mjs'
    const files = [
        {path: `${dir}/${entry}`, b64: toB64(scriptText)},
        {path: `${dir}/params.json`, b64: toB64(JSON.stringify(params.parameters || {}))},
        {path: `${dir}/command.txt`, b64: toB64(String(params.commandName || 'executeCommand'))},
        {path: `${dir}/harness.mjs`, b64: toB64(HARNESS)},
    ]
    const envPrefix = [
        params.hostBase ? `SKILL_HOST_BASE=${shellQuote(trimSlash(params.hostBase))}` : '',
        params.token ? `SKILL_CAP_TOKEN=${shellQuote(params.token)}` : '',
    ].filter(Boolean)
    for (const [k, v] of Object.entries(params.env || {})) {
        envPrefix.push(`${k}=${shellQuote(String(v))}`)
    }
    const command = [
        `mkdir -p ${shellQuote(dir)}`,
        ...files.map(x => `printf %s ${shellQuote(x.b64)} | base64 -d > ${shellQuote(x.path)}`),
        `cd ${shellQuote(dir)}`,
        `${envPrefix.length ? envPrefix.join(' ') + ' ' : ''}node ${shellQuote(`${dir}/harness.mjs`)}`,
    ].join(' && ')
    return {dir, files, command}
}

/**
 * harness：命令名与参数从文件读（不拼进命令行，避免引号嵌套把参数撕坏）；
 * 结果统一打成带标记的一行 JSON，出错也打标记，调用方因此永远有确定的读取点。
 * 相对路径依赖 shell 已经 cd 到工作目录。
 */
export const HARNESS = `import {readFileSync} from 'node:fs'
const mark = '${RESULT_MARK}'
const out = (obj) => { process.stdout.write('\\n' + mark + JSON.stringify(obj) + '\\n') }
try {
  const commandName = readFileSync('./command.txt', 'utf8').trim()
  const params = JSON.parse(readFileSync('./params.json', 'utf8') || '{}')
  const mod = await import('./skill.mjs')
  let result
  if (typeof mod.executeCommand === 'function') {
    result = await mod.executeCommand(commandName, params)
  } else if (typeof mod[commandName] === 'function') {
    result = await mod[commandName](params)
  } else {
    throw new Error('skill 脚本既没有 executeCommand 也没有 ' + commandName + ' 导出')
  }
  out({ ok: true, result })
} catch (e) {
  out({ ok: false, error: String((e && e.message) || e) })
}
`

/**
 * @description 从 execd 的 NDJSON stdout 里取回结果
 * @author xianyang
 * @param {String} stdout 已解析出的 stdout 文本
 * @returns {Object} {ok, result, error}
 */
export function parseBundleResult(stdout) {
    const text = String(stdout || '')
    const idx = text.lastIndexOf(RESULT_MARK)
    if (idx < 0) {
        const tail = text.trim().split('\n').slice(-1)[0] || ''
        return {ok: false, error: `skill 未输出结果标记，最后一段输出：${tail.slice(0, 200)}`}
    }
    const line = text.slice(idx + RESULT_MARK.length).split('\n')[0]
    try {
        const obj = JSON.parse(line)
        if (obj && obj.ok === false) {
            return {ok: false, error: obj.error || 'skill 执行失败'}
        }
        return {ok: true, result: obj ? obj.result : null}
    } catch {
        return {ok: false, error: `结果标记后的内容不是合法 JSON：${line.slice(0, 200)}`}
    }
}

function toB64(s) {
    return Buffer.from(String(s), 'utf8').toString('base64')
}

/** 单引号包裹并转义内部单引号，防止脚本内容/参数逃出 shell 参数 */
function shellQuote(s) {
    return `'${String(s).replace(/'/g, `'\\''`)}'`
}

function trimSlash(s) {
    return String(s || '').replace(/\/+$/, '')
}

export default {NODE_BUILTINS, RESULT_MARK, HARNESS, stripComments, checkSelfContained, buildSkillBundle, parseBundleResult}
