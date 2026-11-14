/**
 * @fileOverview doc.api 转投的用例（契约按 doc.api 源码核验，非自证）
 * @module test/services/core/artifact/docApiUpload
 * @description
 * 三条最值钱的断言：
 * ① user-info 头用 **doc.api 的解码链**（base64→decodeURIComponent→JSON.parse）反解回来必须等于原对象——
 *    编解码两侧各写各的、只在真机 401/落空 operator 才发现是这类集成 bug 的典型；
 * ② finish 拿 doc.api 回显的 fileSize 核对实发字节（截断不许被当成功登记）；
 * ③ fileCode 是入参不是自造（分配即重试/对账锚点）。
 */
import {test, describe} from 'node:test'
import * as assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

function findSrc(startDir) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
        if (fs.existsSync(path.join(dir, 'services/core/artifact/docApiUpload.js'))) return dir
        const up = path.dirname(dir)
        if (up === dir) break
        dir = up
    }
    throw new Error('找不到 src 根')
}
const SRC = findSrc(path.dirname(fileURLToPath(import.meta.url)))
const M = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/docApiUpload.js')).href)
const {makeDocApiUploader, buildUserInfoHeader, interpretDocApiReply, buildDownloadUrl} = M
const {INTAKE_ERRORS} = await import(pathToFileURL(path.join(SRC, 'services/core/artifact/intakeErrors.js')).href)

const cfg = {baseIntranetUrl: 'http://doc.internal', baseUrl: 'https://doc.pub', timeoutMs: 5000}

describe('1 user-info 头编解码（对 doc.api 解码链负责，不是自证）', () => {
    test('按 init-params.js 的 base64→decodeURIComponent→JSON.parse 反解回来=原对象', () => {
        const h = buildUserInfoHeader({userCode: 'u-9', realName: '张三 100%'})
        const back = JSON.parse(decodeURIComponent(Buffer.from(h, 'base64').toString('utf8')))
        assert.deepEqual(back, {userCode: 'u-9', realName: '张三 100%'})
    })
    test('realName 缺省回退 userCode（不能空着）', () => {
        const back = JSON.parse(decodeURIComponent(Buffer.from(buildUserInfoHeader({userCode: 'u1'}), 'base64').toString('utf8')))
        assert.equal(back.realName, 'u1')
    })
})

describe('2 interpretDocApiReply：只认 code:0 且有 fileCode', () => {
    const ok = {status: 200, json: {code: 0, data: {fileCode: 'fc-1', fileSize: 5}}}
    test('成功信封取 data', () => {
        assert.equal(interpretDocApiReply(ok).fileCode, 'fc-1')
    })
    test('非 2xx / code≠0 / 无 fileCode / 非 JSON ⇒ 各抛对应稳定码', () => {
        assert.throws(() => interpretDocApiReply({status: 500, json: {msg: 'boom'}}), new RegExp(INTAKE_ERRORS.DOC_API_FAILED))
        assert.throws(() => interpretDocApiReply({status: 200, json: {code: -1, msg: '文件标识不能重复'}}), new RegExp(`${INTAKE_ERRORS.DOC_API_FAILED}.*文件标识`))
        assert.throws(() => interpretDocApiReply({status: 200, json: {code: 0, data: {}}}), new RegExp(INTAKE_ERRORS.DOC_API_NO_FILECODE))
        assert.throws(() => interpretDocApiReply({status: 200, json: null}), new RegExp(INTAKE_ERRORS.DOC_API_FAILED))
    })
})

describe('3 makeDocApiUploader：请求形状 + 尺寸核对 + fileCode 锚', () => {
    /** 记录请求、按脚本回信封的假 fetch */
    function fakeDoc(reply) {
        const seen = []
        const impl = async (url, init = {}) => {
            seen.push({url, init})
            return {
                status: reply.status,
                ok: reply.status >= 200 && reply.status < 300,
                json: async () => reply.json,
            }
        }
        return {impl, seen}
    }
    const task = {fileCode: 'fc-alloc-1', name: 'report.pdf', mimeType: 'application/pdf'}

    test('缺 fileCode ⇒ 构造即抛（分配是调用方前置，不传就不许开传）', () => {
        assert.throws(() => makeDocApiUploader({task: {name: 'x'}, config: cfg, fetchImpl: fakeDoc({status: 200, json: {code: 0}}).impl}), new RegExp(INTAKE_ERRORS.DOC_API_NO_ALLOC_CODE))
    })
    test('缺基地址 ⇒ 抛 NO_BASE', () => {
        assert.throws(() => makeDocApiUploader({task, config: {}, fetchImpl: async () => ({})}), new RegExp(INTAKE_ERRORS.DOC_API_NO_BASE))
    })
    test('finish 打到 upload/unique?fileCode=，带 user-info 头，multipart 体含全部字节', async () => {
        const {impl, seen} = fakeDoc({status: 200, json: {code: 0, data: {fileCode: 'fc-alloc-1', fileSize: 8}}})
        const u = makeDocApiUploader({task, config: cfg, userInfo: {userCode: 'u1', realName: '张三'}, fetchImpl: impl})
        await u.write(Buffer.from('ABC'), 0)
        await u.write(Buffer.from('DEFGH'), 1)
        const r = await u.finish()
        assert.equal(seen[0].url, 'http://doc.internal/file/upload/unique?fileCode=fc-alloc-1')
        assert.equal(seen[0].init.method, 'POST')
        assert.ok(seen[0].init.headers['user-info'], '必须带 user-info')
        assert.ok(seen[0].init.body instanceof FormData, 'FormData 体（服务端 request.file() 要 multipart）')
        assert.equal(seen[0].init.body.get('file').size, 8, '两段攒成 8 字节')
        assert.deepEqual(r, {fileCode: 'fc-alloc-1', fileUrl: 'https://doc.pub/file/download/report.pdf?fileCode=fc-alloc-1', sizeBytes: 8, docFileHashCode: ''})
    })
    test('doc.api 回显 fileSize ≠ 实发 ⇒ SIZE_MISMATCH（截断不许当成功）', async () => {
        const {impl} = fakeDoc({status: 200, json: {code: 0, data: {fileCode: 'fc', fileSize: 999}}})
        const u = makeDocApiUploader({task, config: cfg, fetchImpl: impl})
        await u.write(Buffer.from('short'))
        await assert.rejects(u.finish(), new RegExp(INTAKE_ERRORS.DOC_API_SIZE_MISMATCH))
    })
    test('超时（AbortError）⇒ 包成 DOC_API_FAILED 请求失败', async () => {
        const impl = async (url, init = {}) => {
            const e = new Error('aborted'); e.name = 'AbortError'
            init.signal?.addEventListener?.('abort', () => {})
            throw e
        }
        const u = makeDocApiUploader({task, config: cfg, fetchImpl: impl})
        await u.write(Buffer.from('x'))
        await assert.rejects(u.finish(), new RegExp(`${INTAKE_ERRORS.DOC_API_FAILED}.*请求失败`))
    })
    test('abort 后 write 拒绝（丢弃缓冲，喂进来的是脏数据）', async () => {
        const u = makeDocApiUploader({task, config: cfg, fetchImpl: async () => ({status: 200, json: async () => ({})})})
        await u.abort()
        await assert.rejects(u.write(Buffer.from('late')), /已 abort/)
    })
    test('folder 透传（存储目录前缀归调用方管）', async () => {
        const {impl, seen} = fakeDoc({status: 200, json: {code: 0, data: {fileCode: 'fc', fileSize: 1}}})
        const u = makeDocApiUploader({task, config: cfg, folder: 'llm-artifacts', fetchImpl: impl})
        await u.write(Buffer.from('x'))
        await u.finish()
        assert.equal(seen[0].init.body.get('folder'), 'llm-artifacts')
    })
})

describe('4 buildDownloadUrl：对外域名优先 + 编码', () => {
    test('用 baseUrl（前端可见域），名与码都 URI 编码', () => {
        const u = buildDownloadUrl({config: cfg, fileCode: 'a b', name: 'r pt.pdf'})
        assert.equal(u, 'https://doc.pub/file/download/r%20pt.pdf?fileCode=a%20b')
    })
    test('无 baseUrl 退回内网（不留空 URL）', () => {
        assert.match(buildDownloadUrl({config: {baseIntranetUrl: 'http://x'}, fileCode: 'f'}), /^http:\/\/x\/file\/download\//)
    })
})
