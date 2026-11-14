/**
 * @fileOverview execd 分段纯契约用例（PR-H2 前置）
 * @module test/services/core/artifact/execdRange
 * @description
 * 这些用例钉的是 §0.1 v1.5 实测到的 execd Range 契约，把"实测值"变成长期防漂的断言：
 * 一旦有人改错 off-by-one / Content-Range 总长 / 416 处理 / 分段计划，CI 立刻红，
 * 而不是等 intake 在真实大文件上悄悄丢一段产物。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/artifact/execdRange.js'))) {
            return dir
        }
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const M = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/execdRange.js')).href)
const {FILE_RESPONSE_KIND, buildRangeHeader, parseContentRange, interpretFileResponse, planRangeSlices} = M

describe('1 buildRangeHeader：闭区间 + 拒绝非法', () => {
    test('正常', () => {
        assert.equal(buildRangeHeader(6, 11), 'bytes=6-11')
        assert.equal(buildRangeHeader(0, 0), 'bytes=0-0')
    })
    test('start<0 / end<start / 非整数 ⇒ 抛（别把越界区间发出去）', () => {
        for (const [s, e] of [[-1, 5], [5, 4], [1.5, 4], [NaN, 2], ['abc', 10]]) {
            assert.throws(() => buildRangeHeader(s, e), /非法 Range/, `${s}~${e} 不该放行`)
        }
    })
})

describe('2 parseContentRange：钉 §0.1 实测串 + 处理 * 与不规范写法', () => {
    test('标准 bytes 6-11/18', () => {
        assert.deepEqual(parseContentRange('bytes 6-11/18'), {unit: 'bytes', start: 6, end: 11, total: 18})
    })
    test('等号写法也认（防上游写法漂移）', () => {
        assert.deepEqual(parseContentRange('bytes=0-1048575/5242880'), {unit: 'bytes', start: 0, end: 1048575, total: 5242880})
    })
    test('total=* ⇒ total:null（没给总长，intake 不许判"取全"）', () => {
        assert.equal(parseContentRange('bytes 0-4/*').total, null)
    })
    test('非法/空 ⇒ null', () => {
        for (const s of ['', '   ', 'items 0-4/10', 'bytes 5/10', 'bytes abc']) {
            assert.equal(parseContentRange(s), null, JSON.stringify(s))
        }
    })
})

describe('3 interpretFileResponse：分类 + mismatch 必须显式暴露', () => {
    test('200 全文 ⇒ FULL, complete, total=收到', () => {
        const r = interpretFileResponse({status: 200, receivedBytes: 18})
        assert.equal(r.kind, FILE_RESPONSE_KIND.FULL)
        assert.equal(r.complete, true)
        assert.equal(r.total, 18)
        assert.equal(r.bytesMismatch, false)
    })
    test('200 零字节 ⇒ EMPTY', () => {
        const r = interpretFileResponse({status: 200, receivedBytes: 0})
        assert.equal(r.kind, FILE_RESPONSE_KIND.EMPTY)
        assert.equal(r.total, 0)
    })
    test('206 精确段（§0.1 实测 bytes 6-11/18, 收到6）⇒ PARTIAL, 非 complete, 无 mismatch', () => {
        const r = interpretFileResponse({status: 206, contentRange: 'bytes 6-11/18', receivedBytes: 6, requested: {start: 6, end: 11}})
        assert.equal(r.kind, FILE_RESPONSE_KIND.PARTIAL)
        assert.equal(r.total, 18)
        assert.equal(r.complete, false, '6-11/18 末字节 11 < 17，不该判取全')
        assert.equal(r.bytesMismatch, false)
    })
    test('206 最后一段（0-17/18）⇒ complete', () => {
        const r = interpretFileResponse({status: 206, contentRange: 'bytes 0-17/18', receivedBytes: 18})
        assert.equal(r.complete, true)
    })
    test('206 收到字节 ≠ 区间长度 ⇒ bytesMismatch=true（服务端少给/多给不许被当正常）', () => {
        const r = interpretFileResponse({status: 206, contentRange: 'bytes 6-11/18', receivedBytes: 5})
        assert.equal(r.bytesMismatch, true)
        assert.match(r.reason, /byte-count-mismatch/)
    })
    test('206 但区间与请求不符（服务端忽略 Range 回了 0..17）⇒ mismatch 标记', () => {
        const r = interpretFileResponse({status: 206, contentRange: 'bytes 0-17/18', receivedBytes: 18, requested: {start: 6, end: 11}})
        assert.equal(r.bytesMismatch, true)
        assert.match(r.reason, /not-as-requested/)
    })
    test('206 无 Content-Range ⇒ ERROR（不可信，不默认成功）', () => {
        const r = interpretFileResponse({status: 206, receivedBytes: 6})
        assert.equal(r.kind, FILE_RESPONSE_KIND.ERROR)
    })
    test('200 却带 Content-Range ⇒ ERROR + mismatch（异常混合）', () => {
        const r = interpretFileResponse({status: 200, contentRange: 'bytes 0-4/18', receivedBytes: 5})
        assert.equal(r.kind, FILE_RESPONSE_KIND.ERROR)
        assert.equal(r.bytesMismatch, true)
    })
    test('404 ⇒ NOT_FOUND；416 ⇒ RANGE_UNSATISFIABLE（都 complete=false）', () => {
        assert.equal(interpretFileResponse({status: 404, receivedBytes: 0}).kind, FILE_RESPONSE_KIND.NOT_FOUND)
        const r416 = interpretFileResponse({status: 416, receivedBytes: 0})
        assert.equal(r416.kind, FILE_RESPONSE_KIND.RANGE_UNSATISFIABLE)
        assert.equal(r416.complete, false)
    })
    test('其它状态 ⇒ ERROR', () => {
        assert.equal(interpretFileResponse({status: 500, receivedBytes: 0}).kind, FILE_RESPONSE_KIND.ERROR)
        assert.equal(interpretFileResponse({status: 503, receivedBytes: 0}).kind, FILE_RESPONSE_KIND.ERROR)
    })
})

describe('4 planRangeSlices：覆盖 [0,total) 无重叠不漏尾、尾段变短', () => {
    test('18 字节 / 段≤5 ⇒ 4 段覆盖 0..17 且尾段短', () => {
        const s = planRangeSlices(18, 5)
        assert.deepEqual(s.map((x) => [x.start, x.end]), [[0, 4], [5, 9], [10, 14], [15, 17]])
        // 连续性 + 无重叠 + 覆盖完整
        let cursor = 0
        for (const seg of s) {
            assert.equal(seg.start, cursor)
            assert.ok(seg.end >= seg.start)
            assert.ok(seg.end - seg.start + 1 <= 5)
            cursor = seg.end + 1
        }
        assert.equal(cursor, 18)
    })
    test('整除不留空尾段：20/5 ⇒ 4 段止于 19', () => {
        const s = planRangeSlices(20, 5)
        assert.equal(s.length, 4)
        assert.deepEqual([s[0].start, s[3].start, s[3].end], [0, 15, 19])
    })
    test('maxBytes>=total ⇒ 单段 [0,total-1]', () => {
        assert.deepEqual(planRangeSlices(3, 100), [{start: 0, end: 2, index: 0}])
    })
    test('1MB 段 × 5MB ⇒ 首段正是 §0.1 实测的 0-1048575', () => {
        const s = planRangeSlices(5 * 1024 * 1024, 1024 * 1024)
        assert.deepEqual([s[0].start, s[0].end], [0, 1048575])
        assert.equal(s.length, 5)
    })
    test('total<=0 / 非法 ⇒ 空计划（空文件走整取，不发 Range）', () => {
        for (const t of [0, -1, NaN, 1.5]) {
            assert.deepEqual(planRangeSlices(t, 5), [])
        }
        assert.deepEqual(planRangeSlices(10, 0), [], 'maxBytes<=0 不给计划')
    })
    test('每段独立可用于 buildRangeHeader（不产生非法区间）', () => {
        for (const seg of planRangeSlices(18, 5)) {
            assert.match(buildRangeHeader(seg.start, seg.end), /^bytes=\d+-\d+$/)
        }
    })
})
