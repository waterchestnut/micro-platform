/**
 * @fileOverview openSandbox 文件传输方法（callRaw/fileInfo/downloadFile/fetchFileBytes）离线用例
 * @module test/services/sandbox/openSandboxFiles
 * @description
 * 假 fetch 按 §0.1 dev 实测的 execd 行为造（206+Content-Range+精确段长、越界 416、代理 URL、鉴权头），
 * 另加三种"服务端不守规矩"的剧本：忽略 Range 回 200 全文、分段只回半截、intake 中途文件消失——
 * 这些正是 fetchFileBytes 必须**抛**而不能静默拼装的场景。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import {createSandboxClient} from '../../../services/sandbox/openSandbox.js'

const baseCfg = {
    baseUrl: 'http://sandbox.test:30980',
    apiKey: 'k-1',
    requestTimeoutMs: 500,
}

/** 造一个响应（headers 用 Headers-like 的 get，走 callRaw 的摊平分支） */
function resp(status, headers, buffer) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {get: (k) => (headers[String(k).toLowerCase()] ?? null)},
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    }
}

/**
 * 虚拟文件服务器：忠实执行 §0.1 实测的 Range 语义。
 * opts: {ignoreRange, shortBytes, shrinkTo, failDownloadAt, infoNoSize}
 */
function fileServer(content, opts = {}) {
    const buf = Buffer.from(content)
    const calls = []
    let downloads = 0
    const impl = async (url, init = {}) => {
        calls.push({url, method: init.method || 'GET', headers: init.headers || {}})
        const u = new URL(url)
        if (u.pathname.endsWith('/files/info')) {
            const p = u.searchParams.get('path') || ''
            const shape = opts.infoNoSize ? {mtime: 'x'} : {size: buf.length, mtime: '2026-01-01'}
            // 默认用 **2026-11-14 live 实测形状**（路径为键）；flatInfoShape 兼容扁平写法另用例钉
            const body = opts.flatInfoShape ? shape : {[p]: {...shape, path: p, type: 'file'}}
            return resp(200, {'content-type': 'application/json'}, Buffer.from(JSON.stringify(body)))
        }
        if (u.pathname.endsWith('/files/download')) {
            downloads++
            if (opts.failDownloadAt === downloads) return resp(404, {}, Buffer.from('no such file'))
            if (opts.shrinkTo && downloads > opts.shrinkFrom) {
                // 文件"缩了"：请求超出新 EOF ⇒ 416
                const m = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range || '')
                if (m && Number(m[1]) >= opts.shrinkTo) return resp(416, {}, Buffer.alloc(0))
            }
            const range = init.headers.Range
            if (!range || opts.ignoreRange) {
                return resp(opts.ignoreRange && range ? 200 : 200, {'content-type': 'application/octet-stream'}, buf)
            }
            const m = /^bytes=(\d+)-(\d+)$/.exec(range)
            if (!m) return resp(400, {}, Buffer.from('bad range'))
            const s = Number(m[1])
            let e = Number(m[2])
            let seg = buf.subarray(s, e + 1)
            if (opts.shortBytes && downloads === opts.shortBytes.at) seg = seg.subarray(0, seg.length - 2)
            return resp(206, {'content-range': `bytes ${s}-${s + seg.length - 1}/${buf.length}`}, seg)
        }
        return resp(404, {}, Buffer.alloc(0))
    }
    return {impl, calls}
}

describe('1 fileInfo：代理 URL/鉴权头/404 当事实', () => {
    test('走 lifecycle 代理路径并带 OPEN-SANDBOX-API-KEY；size 解析出来（live 实测：路径为键的形状）', async () => {
        const {impl, calls} = fileServer('hello')
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        const r = await c.fileInfo({sandboxId: 's1', path: '/workspace/a.txt'})
        assert.equal(r.found, true)
        assert.equal(r.size, 5, 'extractSize 必须吃下 {"/path":{size}} 的实测形状')
        assert.equal(calls[0].url, 'http://sandbox.test:30980/v1/sandboxes/s1/proxy/44772/files/info?path=/workspace/a.txt')
        assert.equal(calls[0].headers['OPEN-SANDBOX-API-KEY'], 'k-1')
    })
    test('扁平 {size} 形状也兼容（服务端写法若回退不许瞎掉）', async () => {
        const {impl} = fileServer('hello', {flatInfoShape: true})
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        const r = await c.fileInfo({sandboxId: 's1', path: '/a'})
        assert.equal(r.size, 5)
        await c.fetchFileBytes({sandboxId: 's1', path: '/a', sliceBytes: 3}) // 不抛即通过
    })
    test('404 ⇒ found:false 不抛（文件不存在是判据输入，不是异常）', async () => {
        const c = createSandboxClient({...baseCfg, fetchImpl: async () => resp(404, {}, Buffer.from('gone'))})
        const r = await c.fileInfo({sandboxId: 's1', path: '/nope'})
        assert.equal(r.found, false)
        assert.equal(r.status, 404)
        assert.equal(r.rawText, 'gone')
    })
    test('5xx ⇒ found:false（非 404 的失败绝不能因"不是 404"就当真找到了）', async () => {
        const c = createSandboxClient({...baseCfg, fetchImpl: async () => resp(500, {}, Buffer.from('boom'))})
        const r = await c.fileInfo({sandboxId: 's1', path: '/x'})
        assert.equal(r.found, false)
        assert.equal(r.status, 500)
        await assert.rejects(c.fetchFileBytes({sandboxId: 's1', path: '/x'}), /目标不存在/)
    })
})

describe('2 downloadFile：单段语义复用 execdRange 判据', () => {
    test('无 Range ⇒ 200 全文 FULL', async () => {
        const {impl} = fileServer('hello')
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        const {bytes, verdict} = await c.downloadFile({sandboxId: 's1', path: '/w/a'})
        assert.equal(bytes.toString(), 'hello')
        assert.equal(verdict.kind, 'full')
        assert.equal(verdict.complete, true)
    })
    test('Range 6-11（§0.1 实测串）⇒ 发出 Range 头、206、PARTIAL、字节精确', async () => {
        const {impl, calls} = fileServer('abcdefghijklmnopqr')
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        const {bytes, verdict} = await c.downloadFile({sandboxId: 's1', path: '/w/a', start: 6, end: 11})
        assert.equal(calls[0].headers.Range, 'bytes=6-11')
        assert.equal(bytes.toString(), 'ghijkl')
        assert.equal(verdict.kind, 'partial')
        assert.equal(verdict.total, 18)
        assert.equal(verdict.complete, false)
        assert.equal(verdict.bytesMismatch, false)
    })
    test('非法区间（end<start / 只给一半）⇒ 发之前就抛，不污染网络', async () => {
        let hit = 0
        const c = createSandboxClient({...baseCfg, fetchImpl: async (...a) => { hit++; return resp(200, {}, Buffer.alloc(0)) }})
        await assert.rejects(c.downloadFile({sandboxId: 's', path: '/a', start: 5, end: 4}), /非法 Range/)
        await assert.rejects(c.downloadFile({sandboxId: 's', path: '/a', start: 3}), /非法 Range/)
        assert.equal(hit, 0, '非法区间不该发出任何请求')
    })
})

describe('3 fetchFileBytes：分段编排 + 完整性闸门', () => {
    test('13 字节 / 段≤5 ⇒ 3 段顺序正确、onSlice 逐段、总字节相符', async () => {
        const {impl, calls} = fileServer('ABCDEFGHIJKLM')
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        const seen = []
        const ret = await c.fetchFileBytes({sandboxId: 's1', path: '/w/f', sliceBytes: 5, onSlice: (b, i) => seen.push([i, b.toString()])})
        assert.deepEqual(ret, {total: 13, sliceCount: 3, bytes: 13})
        const ranges = calls.filter((x) => x.url.includes('/files/download')).map((x) => x.headers.Range)
        assert.deepEqual(ranges, ['bytes=0-4', 'bytes=5-9', 'bytes=10-12'])
        assert.deepEqual(seen, [[0, 'ABCDE'], [1, 'FGHIJ'], [2, 'KLM']])
    })
    test('小文件单段覆盖全文件（含服务端无视 Range 回 200）⇒ 接受', async () => {
        const {impl} = fileServer('ABCDEFGHIJKLM', {ignoreRange: true})
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        const ret = await c.fetchFileBytes({sandboxId: 's1', path: '/w/f', sliceBytes: 50})
        assert.equal(ret.bytes, 13)
    })
    test('分段请求被服务端无视 Range 回全文 ⇒ 抛（拒绝拼装）', async () => {
        const {impl} = fileServer('ABCDEFGHIJKLM', {ignoreRange: true})
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        await assert.rejects(c.fetchFileBytes({sandboxId: 's1', path: '/w/f', sliceBytes: 5}), /忽略 Range/)
    })
    test('分段只回半截（字节数≠区间）⇒ 抛并带已取字节', async () => {
        const {impl} = fileServer('ABCDEFGHIJKLM', {shortBytes: {at: 2}})
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        await assert.rejects(c.fetchFileBytes({sandboxId: 's1', path: '/w/f', sliceBytes: 5}), /取回异常/)
    })
    test('中途文件消失（404）⇒ 抛，不静默截短', async () => {
        const {impl} = fileServer('ABCDEFGHIJKLM', {failDownloadAt: 2})
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        await assert.rejects(c.fetchFileBytes({sandboxId: 's1', path: '/w/f', sliceBytes: 5}), /取回异常/)
    })
    test('中途文件缩了（416 越过新 EOF）⇒ 抛（别把残段当完整）', async () => {
        const {impl} = fileServer('ABCDEFGHIJKLM', {shrinkTo: 6, shrinkFrom: 1})
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        await assert.rejects(c.fetchFileBytes({sandboxId: 's1', path: '/w/f', sliceBytes: 5}), /取回异常/)
    })
    test('总上限闸门：超限直接拒，一个下载请求都不发', async () => {
        const {impl, calls} = fileServer('ABCDEFGHIJKLM')
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        await assert.rejects(c.fetchFileBytes({sandboxId: 's1', path: '/w/f', sliceBytes: 5, maxTotalBytes: 10}), /超过 intake 上限/)
        assert.ok(!calls.some((x) => x.url.includes('/files/download')), '闸门必须先于任何字节拉取')
    })
    test('空文件 ⇒ total:0、一段回调、不发 Range 下载之外的请求', async () => {
        const {impl} = fileServer('')
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        const seen = []
        const ret = await c.fetchFileBytes({sandboxId: 's1', path: '/w/empty', onSlice: (b) => seen.push(b.length)})
        assert.equal(ret.total, 0)
        assert.deepEqual(seen, [0])
    })
    test('info 不给 size ⇒ 抛"未给出可靠 size"（不猜总长瞎分段）', async () => {
        const {impl} = fileServer('ABC', {infoNoSize: true})
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        await assert.rejects(c.fetchFileBytes({sandboxId: 's1', path: '/w/a'}), /可靠 size/)
    })
    test('目标不存在 ⇒ 抛"intake 目标不存在"，无下载请求', async () => {
        const c = createSandboxClient({...baseCfg, fetchImpl: async () => resp(404, {}, Buffer.from('gone'))})
        await assert.rejects(c.fetchFileBytes({sandboxId: 's1', path: '/w/x'}), /目标不存在/)
    })
})

describe('4 callRaw：传输层失败仍抛；headers 摊平可读', () => {
    test('fetch 抛（超时/不可达）⇒ 包成 OpenSandbox(raw) 错误', async () => {
        const c = createSandboxClient({...baseCfg, fetchImpl: async () => { throw Object.assign(new Error('socket hang up'), {name: 'TypeError'}) }})
        await assert.rejects(c.callRaw('/files/info?path=/a', {baseUrl: 'http://x/v1'}), /OpenSandbox\(raw\).*socket hang up/)
    })
    test('content-range 摊平成小写键（interpretFileResponse 直接可用）', async () => {
        const {impl} = fileServer('abcdefghijklmnopqr')
        const c = createSandboxClient({...baseCfg, fetchImpl: impl})
        const r = await c.callRaw('/files/download?path=/w', {baseUrl: 'http://x/v1/sandboxes/s/proxy/44772', headers: {Range: 'bytes=6-11'}})
        assert.equal(r.status, 206)
        assert.equal(r.headers['content-range'], 'bytes 6-11/18')
        assert.equal(r.buffer.length, 6)
    })
})
