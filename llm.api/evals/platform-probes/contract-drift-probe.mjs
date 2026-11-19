/**
 * @fileOverview 前端取回入口与 llm.api 协议常量的漂移核对（只读）
 * @module evals/platform-probes/contract-drift-probe
 * @description
 * 这一对数字是**跨仓的**：`PAGE_SIZE`（前端）必须等于 `OVERFLOW_DEFAULT_LIMIT`（服务端），
 * 前端识别"这条被裁过"用的标记串必须等于 `clipTraceResult` 实际拼上去的那个尾巴。
 * 两边各写一份、只改一边，是这个项目反复出现的失败形状（`toolArgsChars` 那次我在配置面与函数签名
 * 两处钉了"必须同数"，但**跨仓**这一环没有任何断言覆盖，靠的是我当时抄得对）。
 *
 * 探针而不是单测：它会读另一个仓的文件。放进单测就意味着 CI 依赖旁仓存在——
 * 那种测试在旁仓缺席时会"静默通过"，而**静默通过的守卫比没有守卫更危险**
 * （本轮我刚被一条"检查文件里有没有某个词、其实没检查到导入"的判据骗过一次）。
 * 所以这里：旁仓找不到就明确报 `skipped`，并在最后要求每一项都必须"读过"才算通过。
 *
 * 用法：node evals/platform-probes/contract-drift-probe.mjs [--front=D:/workspace/xxzx/xxzx.console]
 */
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
/**
 * @description 取 --name=value
 * @param {String} n 键
 * @param {String} d 缺省
 * @returns {String} 值
 */
const val = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`))
    return hit ? hit.slice(n.length + 3) : d
}
const FRONT = val('front', 'D:/workspace/xxzx/xxzx.console')

await import('../../init.js')
const tools = await import('../../tools/overflow.js')
const llmLoop = await import('../../services/core/llmLoop.js')

const checks = []
/**
 * @description 记一条核对
 * @param {String} name 名称
 * @param {Boolean} ok 是否一致
 * @param {Object} detail 读数
 * @returns {void}
 */
function note(name, ok, detail) {
    checks.push({name, ok, ...detail})
}

/** 服务端侧的事实 */
const SERVER = {
    defaultLimit: tools.OVERFLOW_DEFAULT_LIMIT,
    maxLimit: tools.OVERFLOW_MAX_LIMIT,
    routePath: '/core/message/tool-result',
}
/** 标记串必须从实现里读，不能抄字面量：抄了就和"用记忆对齐"没区别 */
const marker = llmLoop.clipTraceResult('x'.repeat(10), 3).slice(3)
SERVER.marker = marker

const files = {
    module: path.join(FRONT, 'src/chatProviders/toolResult.ts'),
    client: path.join(FRONT, 'src/services/llm/toolResultClient.ts'),
    page: path.join(FRONT, 'src/pages/Chat/index.tsx'),
}
const missing = Object.entries(files).filter(([, f]) => !fs.existsSync(f)).map(([k]) => k)
if (missing.length) {
    console.log(JSON.stringify({ok: false, skipped: true, 缺少: missing, 说明: '旁仓文件不在，本轮核对没有发生 ⇒ 不算通过'}, null, 1))
    process.exit(0)
}
const mod = fs.readFileSync(files.module, 'utf8')
const client = fs.readFileSync(files.client, 'utf8')
const page = fs.readFileSync(files.page, 'utf8')

/**
 * @description 从源码里取一个数字常量
 * @param {String} text 源码
 * @param {String} name 常量名
 * @returns {Number|null} 值
 */
function numConst(text, name) {
    const m = new RegExp(`export const ${name}\\s*=\\s*(\\d+)`).exec(text)
    return m ? Number(m[1]) : null
}
const pageSize = numConst(mod, 'PAGE_SIZE')
note('PAGE_SIZE == 服务端 OVERFLOW_DEFAULT_LIMIT', pageSize === SERVER.defaultLimit,
    {前端: pageSize, 服务端: SERVER.defaultLimit})

const maxPages = numConst(mod, 'MAX_PAGES')
note('MAX_PAGES 是正数（否则一次都翻不动）', typeof maxPages === 'number' && maxPages > 0, {前端: maxPages})

/** 前端识别"被裁过"的标记串必须与服务端拼上去的那一串一致 */
const clippedLine = mod.split('\n').find((l) => /const clipped =/.test(l)) || ''
/**
 * 取 `/.../ ` 之间的正文。上一版我用 `\/...\/$` 去匹配，等于假设这个正则字面量必须以 `$` 结尾，
 * 于是读到 null —— 而 null 被我当成了"前端没做截断识别"的候选结论。
 * **提取失败必须显式进读数，不能沉默默认成被测对象有问题**（这一轮我已经吃过一次"判据检查了个空"）。
 */
const mSlash = /\/([^/]+)\/[a-z]*\.test\(/.exec(clippedLine)
const frontMarkerPattern = mSlash ? mSlash[1] : null
const frontMarkerLiteral = frontMarkerPattern ? frontMarkerPattern.replace(/\\/g, '').replace(/\$$/, '') : null
note('前端识别的截断标记 == clipTraceResult 实际拼的尾巴',
    Boolean(frontMarkerLiteral) && marker.endsWith(frontMarkerLiteral),
    {前端整行: clippedLine.trim().slice(0, 70), 提取出: frontMarkerLiteral, 服务端尾巴: marker})

/** 前端调用的路径必须就是注册的那条 */
note('前端 URL 指向已注册的路由', page.includes(SERVER.routePath),
    {页面含路由路径: page.includes(SERVER.routePath), client含路径: client.includes(SERVER.routePath)})

/** 客户端把非 0 的 code 当失败抛（否则 404 的正文会被当成空页静默收下） */
note('前端把包装层的非 0 code 抛成错误', /env\?\.code[\s\S]{0,80}!==\s*0|code !== 0/.test(client), {})

/** 服务端路由 schema 里写的默认/上限与常量一致（同仓内两处字面量最容易漂） */
const routeSrc = fs.readFileSync(path.join('D:/workspace/xxzx/xxzx.llm.api/src', 'routes/core/message/root.js'), 'utf8')
note('路由描述里的 4000/20000 == 常量', routeSrc.includes(`默认 ${SERVER.defaultLimit}`) && routeSrc.includes(`上限 ${SERVER.maxLimit}`),
    {默认: SERVER.defaultLimit, 上限: SERVER.maxLimit})

/**
 * 四端一致性：`toolResult.ts` 必须与 console 那份**逐字节相同**，
 * 否则"什么时候该取/取到什么算完"就重新变成四份实现——这正是本仓一路在防的漂移。
 * 逐字节比较用 Buffer.compare，不比"看起来一样"：样式改动、漏改一份都会在这里显形。
 */
const ENDS = [
    ['console', path.join(FRONT, 'src/chatProviders/toolResult.ts')],
    ['pdfviewer', 'D:/workspace/xxzx/xxzx.pdfviewer.console/src/chatProviders/toolResult.ts'],
    ['mopit', 'D:/workspace/xxzx/xxzx.mopit.console/src/chatProviders/toolResult.ts'],
    ['raisef', 'D:/workspace/xxzx/xxzx.raisef.console/src/providers/toolResult.ts'],
]
const base = fs.readFileSync(path.join(FRONT, 'src/chatProviders/toolResult.ts'))
for (const [name, f] of ENDS) {
    if (!fs.existsSync(f)) {
        note(`四端一致性/${name}`, false, {说明: '文件不存在'})
        continue
    }
    const same = Buffer.compare(base, fs.readFileSync(f)) === 0
    note(`四端一致性/${name} 与 console 逐字节相同`, same, {路径: f.replace(/^.*xxzx\./, ''), 相同: same})
    const ps2 = numConst(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), 'PAGE_SIZE')
    note(`四端一致性/${name} 的 PAGE_SIZE`, ps2 === SERVER.defaultLimit, {读数: ps2, 服务端: SERVER.defaultLimit})
}

const failed = checks.filter(c => !c.ok)
console.log(JSON.stringify({
    ok: failed.length === 0,
    核对项数: checks.length,
    未过: failed.map(f => ({项: f.name, 读数: f})),
    全部: checks.map(c => `${c.ok ? 'OK ' : 'FAIL'} ${c.name}`),
}, null, 1))
process.exit(failed.length ? 1 : 0)
