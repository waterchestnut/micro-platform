import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {decideOverlap, overlapNote, OVERLAP_REJECT_CODE} from '../../../../services/core/session/runOverlap.js'
import {rejectResponse} from '../../../../services/core/session/runGate.js'

/**
 * P5 的**接线**不变量。
 *
 * 为什么单独有这一份：`runOverlap.test.js` 证明判据本身对，但判据对而没接线，
 * 用户看到的东西一个字都不会变——这正是 B2 那天的失败形状（纯函数全绿、界面永远不说），
 * 也是我这次不愿意再靠"点一下才发现"的东西。
 */

/** 本文件在 src/test/services/core/session/ ⇒ 回到 src 需要上跳四级 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
/**
 * @description 读源文件行（去 CR）
 * @param {String} rel 相对 src 的路径
 * @returns {String[]} 行
 */
function linesOf(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '').split('\n')
}
/**
 * @description 只取代码行（注释里的符号不算命中——这条纪律是被"注释当文案"坑过之后加的）
 * @param {String[]} ls 行
 * @returns {String[]} 结果
 */
function codeOnly(ls) {
    return ls.filter((l) => !/^\s*(\*|\/\/)/.test(l.trim()))
}

describe('路由：检测在 writeHead 之前，且拒绝与放行都留痕', () => {
    const ls = linesOf('routes/core/chat/root.js')
    const code = codeOnly(ls)
    const idx = (re) => code.findIndex((l) => re.test(l))

    test('导入并调用了 findOpenRun / decideOverlap / overlapNote', () => {
        assert.ok(code.some((l) => /llmUsageDac\.findOpenRun\(/.test(l)), '路由没查账本 ⇒ 判据永远拿不到 prev')
        assert.ok(code.some((l) => /decideOverlap\(/.test(l)), '路由没调判定 ⇒ 窗口与拒绝都不生效')
        assert.ok(code.some((l) => /overlapNote\(/.test(l)), '路由没生成记录 ⇒ 档案里说不出缺上下文')
    })

    test('检测排在并发闸之后、SSE 通道建立之前：否则拒绝只能塞进流里，前端分不开"没开始"与"被掐断"', () => {
        const detect = idx(/llmUsageDac\.findOpenRun\(/)
        const gate = idx(/admitRun\(/)
        /**
         * 用 `new AbortController()` 当"通道即将建立"的锚点而不是 `writeHead(`：
         * 本文件里 `writeHead` 出现在多个函数（第 85 行是另一条流的辅助函数），
         * 拿"第一次出现"比较位置会得出假失败/假通过——锚点必须唯一。
         */
        const ctrl = idx(/new AbortController\(/)
        assert.ok(detect >= 0, '找不到检测调用')
        assert.ok(gate >= 0, '找不到并发闸调用（顺序前提变了，本条要重写而不是跳过）')
        assert.ok(ctrl >= 0, '找不到 AbortController 锚点')
        assert.ok(gate < detect, `检测应在闸之后（闸先拒总量），实际 gate=${gate + 1} detect=${detect + 1}`)
        assert.ok(detect < ctrl, `检测应在通道建立之前，实际 detect=${detect + 1} ctrl=${ctrl + 1}`)
    })

    test('拒绝走 rejectResponse 而不是自己拼回法：429 会让四端读不到这句话', () => {
        assert.ok(code.some((l) => /rejectResponse\(/.test(l)), '没有复用 rejectResponse ⇒ 回法会分叉')
    })

    test('检测结果要交给 run（否则档案里没有这件事）', () => {
        assert.ok(code.some((l) => /^\s*runOverlap,/.test(l)), '没把 runOverlap 传进 execChat ⇒ 落库拿不到')
    })

    test('检测失败必须放行（不能把"读不懂数据"变成"用户不能提问"）', () => {
        const i = idx(/同会话重叠检测失败/)
        assert.ok(i >= 0, '没有失败放行的兜底日志')
        assert.ok(code.slice(Math.max(0, i - 6), i).some((l) => /catch\s*\(/.test(l)), '兜底不在 catch 里')
    })
})

describe('DAO 与档案：投影字段齐、落库与视图都带上', () => {
    test('findOpenRun 的投影必须包含 decideOverlap 真正读的字段（缺字段=永远放行且看起来正常）', () => {
        const ls = codeOnly(linesOf('daos/core/dac/llmUsageDac.js'))
        const i = ls.findIndex((l) => /async findOpenRun\(/.test(l))
        assert.ok(i >= 0, 'DAO 没有 findOpenRun')
        /**
         * 断言必须落在**投影字面量那一行**上。
         * 第一版写的是"这段代码里出现过 messageCode / insertTime"，结果把投影改成
         * `{messageCode: 1}` 之后用例照样绿——因为下一行的 `.sort({insertTime: -1})` 也含那个词。
         * 负向对照（删字段必须变红）就是把它抓出来的人。
         */
        const projLine = ls.slice(i, i + 24).find((l) => /findOne\(\s*filter\s*,/.test(l))
        assert.ok(projLine, '找不到 findOne(filter, 投影) 这一行')
        const projBody = (/findOne\(\s*filter\s*,\s*\{([^}]*)\}/.exec(projLine) || [])[1] || ''
        const projKeys = projBody.split(',').map((s) => s.split(':')[0].trim()).filter(Boolean)
        for (const f of ['messageCode', 'insertTime']) {
            assert.ok(projKeys.includes(f), `投影缺 ${f} ⇒ 判定会走 unreadable-time/no-prev 静默放行，实际投影键=${JSON.stringify(projKeys)}`)
        }
        const body = ls.slice(i, i + 24).join('\n')
        assert.ok(/progress:\s*LEDGER_PROGRESS\.PROCESSING/.test(body), '没按未终态过滤 ⇒ 会把已完成的历史轮当并发')
    })

    test('llmChat 把 runOverlap 写进 extInfo，且没有重叠时是 null 而不是缺键', () => {
        const ls = codeOnly(linesOf('services/core/llmChat.js'))
        const hit = ls.filter((l) => /runOverlap:\s*options\.runOverlap \|\| null/.test(l))
        assert.equal(hit.length, 1, `落库点应恰好一处，实际 ${hit.length}`)
    })

    test('messageView 暴露 runOverlap（前端读不到就等于没说）', () => {
        const ls = codeOnly(linesOf('services/core/messageView.js'))
        assert.ok(ls.some((l) => /runOverlap:\s*info\.runOverlap \|\| null/.test(l)), '视图没带这个字段')
    })
})

describe('配置与回法：默认开、窗口窄、错误码独立', () => {
    test('limits.runOverlap 三个键都从 env 走通，默认 enabled/reject 为真、窗口 1500ms', async () => {
        const {default: cfg} = await import('../../../../conf/system.config.js')
        const ro = cfg.limits?.runOverlap
        assert.ok(ro, '配置里没有 limits.runOverlap ⇒ 路由读到 undefined 会当"开"但拿不到窗口')
        assert.equal(ro.enabled, true, '默认必须开：P5 的静默缺上下文是要解决的问题')
        assert.equal(ro.reject, true, '默认必须会拒秒级重复')
        assert.equal(ro.windowMs, 1500, '窗口只该覆盖秒级重复，配大了就会锁住会话')
    })

    test('env 能改窗口与只记录模式（回退路径必须在，否则出问题只能发版）', async () => {
        const prev = {process: null}
        const load = async (env) => {
            Object.entries(env).forEach(([k, v]) => {
                process.env[k] = v
            })
            const rel = '../../../../conf/system.config.js'
            const mod = await import(`${rel}?v=${Math.random()}`)
            Object.keys(env).forEach((k) => {
                delete process.env[k]
            })
            return mod.default.limits.runOverlap
        }
        assert.equal((await load({limits_runOverlap: '0'})).enabled, false, 'limits_runOverlap=0 必须能整体关掉')
        assert.equal((await load({limits_runOverlapReject: '0'})).reject, false, 'reject=0 必须退化成只记录')
        assert.equal((await load({limits_runOverlapWindowMs: '300'})).windowMs, 300, '窗口必须可由 env 调')
    })

    test('拒绝用 4291，与并发闸的 4290 分开，且文案指向"上一条"', () => {
        const d = decideOverlap({prev: {messageCode: 'p1', insertTime: Date.now() - 100}, now: Date.now()})
        assert.equal(d.admit, false)
        const r = rejectResponse(d)
        assert.equal(r.httpStatus, 200, '不能回 429：四端非 2xx 直接 throw，这句话会被丢掉')
        assert.equal(r.body.success, false, '缺 success:false 会被当成正常内容渲染成空回答')
        assert.equal(r.body.code, OVERLAP_REJECT_CODE)
        assert.equal(r.body.code, 4291)
        assert.match(r.body.message, /上一条还在处理中/)
        assert.equal(r.body.data.prevMessageCode, 'p1', 'data 里要能定位是哪一条还没结束')
        assert.ok(Number(r.headers['Retry-After']) >= 1, 'Retry-After 必须是秒且不小于 1')
    })

    test('只记录模式下的 note 形状与档案字段一致（前端按这套键读）', () => {
        const d = decideOverlap({prev: {messageCode: 'p2', insertTime: Date.now() - 60000}, now: Date.now()})
        assert.equal(d.admit, true)
        assert.deepEqual(Object.keys(overlapNote(d)).sort(), ['contextMissing', 'prevAgeMs', 'prevMessageCode', 'reason'])
    })
})
