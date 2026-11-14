/**
 * @fileOverview doc.api 产物转投（artifactIntake 的 beginUpload 生产实现）
 * @module services/core/artifact/docApiUpload
 * @description
 * 契约逐条来自 doc.api 源码（不是猜的）：
 * - `POST /file/upload/unique?fileCode=…`（routes/file/root.js：request.file() 收 multipart，
 *   fileCode 走 query；storeType unique ⇒ **同码重传=原地覆盖**，重试天然安全）；
 * - 内网直连必须自带 `user-info` 头（plugins/init-params.js：base64 → decodeURIComponent → JSON.parse
 *   的解码链，编码必须严格倒序，ragStore 同款信任模型）；
 * - 响应信封（plugins/format-reply.js）：成功 `code:0` + data；失败 `code:-1` + HTTP 状态码；
 * - `saveFile` 返回 `{fileCode, fileHashCode(md5), fileSize, ...}`——fileSize 回显用来**核对传输未截断**，
 *   自报数字对不上就当失败，不给"登记了一个不完整文件"留路。
 *
 * 内存形态说明（诚实的限制）：doc.api 服务端本来就是 `data.toBuffer()` 整对象存储，
 * 这里"分段拉取→攒缓冲→finish 一次 POST"与它的模型一致；峰值=文件大小，由编排侧
 * maxTotalBytes 闸门封顶。真·流式 multipart 需要 doc.api 改管线——超出"零改动"边界，不做。
 */

import {INTAKE_ERRORS} from './intakeErrors.js'

/** 按 doc.api 的解码链（base64→decodeURIComponent→JSON）严格倒序编码；realName 含 % 也不会翻车 */
export function buildUserInfoHeader(userInfo = {}) {
    const json = JSON.stringify({userCode: userInfo.userCode || '', realName: userInfo.realName || userInfo.userCode || ''})
    return Buffer.from(encodeURIComponent(json), 'utf8').toString('base64')
}

/** 从 doc.api 响应信封里取 data；任何非成功形态都抛（宁可回滚，不许带病登记） */
export function interpretDocApiReply({status, json}) {
    if (!(status >= 200 && status < 300)) {
        throw new Error(`${INTAKE_ERRORS.DOC_API_FAILED}：HTTP ${status} ${String(json && (json.msg || json.message) || '').slice(0, 160)}`)
    }
    if (!json || typeof json !== 'object') {
        throw new Error(`${INTAKE_ERRORS.DOC_API_FAILED}：响应不是 JSON 信封`)
    }
    if (Number(json.code) !== 0) {
        throw new Error(`${INTAKE_ERRORS.DOC_API_FAILED}：code=${json.code} ${String(json.msg || '').slice(0, 160)}`)
    }
    const data = json.data || {}
    if (!data.fileCode) {
        // 编排契约：finish 不给 fileCode ⇒ FAILED（外部状态不可知）。这里提前抛，错误归因更准
        throw new Error(`${INTAKE_ERRORS.DOC_API_NO_FILECODE}：上传成功响应里没有 fileCode`)
    }
    return data
}

/**
 * @description 造一个符合 artifactIntake `beginUpload` 契约的上传器
 * @param {Object} params 入参
 * @param {Object} params.task intake 任务（**必须带 task.fileCode**：分配即重试锚点，同码覆盖）
 * @param {Object} params.config docApiConfig 形态（baseIntranetUrl/baseUrl/timeoutMs）
 * @param {Object} params.userInfo 落 operator 的用户身份 {userCode, realName}
 * @param {Function} [params.fetchImpl] 注入 fetch（测试用；缺省全局 fetch）
 * @param {String} [params.folder] doc.api 存储目录前缀（默认走服务端 general）
 * @returns {{write:Function,finish:Function,abort:Function,allocatedFileCode:String}}
 */
export function makeDocApiUploader({task = {}, config = {}, userInfo = {}, fetchImpl, folder} = {}) {
    const base = String(config.baseIntranetUrl || config.baseUrl || '').replace(/\/+$/, '')
    if (!base) {
        throw new Error(`${INTAKE_ERRORS.DOC_API_NO_BASE}：docApiConfig 未配置基地址`)
    }
    const fileCode = String(task.fileCode || '')
    if (!fileCode) {
        // 没有分配好的 fileCode 就开传 = 崩了之后对账找不到账（alloc-without-record 都记不上）
        throw new Error(`${INTAKE_ERRORS.DOC_API_NO_ALLOC_CODE}：转投前必须先分配 fileCode（重试与对账都靠它）`)
    }
    const doFetch = fetchImpl || ((...args) => fetch(...args))
    const timeoutMs = Number(config.timeoutMs) || 120000
    const chunks = []
    let total = 0
    let cleaned = false

    return {
        allocatedFileCode: fileCode,
        /** 攒一段（编排的 onSlice 喂进来）；只攒不发，finish 一次 POST */
        async write(buf) {
            if (cleaned) throw new Error('上传器已 abort，拒绝继续喂数据')
            chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
            total += buf.length
        },
        async finish() {
            const body = Buffer.concat(chunks)
            if (body.length !== total) {
                throw new Error(`${INTAKE_ERRORS.DOC_API_FAILED}：缓冲拼装不符 ${body.length}≠${total}`)
            }
            const form = new FormData()
            form.append('file', new Blob([body], {type: task.mimeType || 'application/octet-stream'}), task.name || 'artifact.bin')
            if (folder) {
                form.append('folder', folder)
            }
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeoutMs)
            let res
            try {
                res = await doFetch(`${base}/file/upload/unique?fileCode=${encodeURIComponent(fileCode)}`, {
                    method: 'POST',
                    headers: {'user-info': buildUserInfoHeader(userInfo)},
                    body: form,
                    signal: controller.signal,
                })
            } catch (e) {
                const why = e && e.name === 'AbortError' ? `超时 ${timeoutMs}ms` : (e && e.message) || String(e)
                throw new Error(`${INTAKE_ERRORS.DOC_API_FAILED}：请求失败 ${why}`)
            } finally {
                clearTimeout(timer)
            }
            let json = null
            try { json = await res.json() } catch { /* 信封解析在 interpret 里统一报错 */ }
            const data = interpretDocApiReply({status: res.status, json})
            const remoteSize = Number(data.fileSize)
            if (Number.isInteger(remoteSize) && remoteSize !== total) {
                // doc.api 回显的 fileSize 与本地攒的字节不符 ⇒ 传输被截断/服务端读错，宁可失败
                throw new Error(`${INTAKE_ERRORS.DOC_API_SIZE_MISMATCH}：doc.api 记 ${remoteSize}，实发 ${total}`)
            }
            return {
                fileCode: String(data.fileCode),
                fileUrl: buildDownloadUrl({config, fileCode: String(data.fileCode), name: task.name || 'artifact.bin'}),
                sizeBytes: total,
                docFileHashCode: String(data.fileHashCode || ''),
            }
        },
        /** 一次 POST 模型下 abort=丢弃缓冲；服务端要么没收到要么是个完整旧版，无残片语义 */
        async abort() {
            cleaned = true
            chunks.length = 0
            total = 0
        },
    }
}

/** 产物下载地址（前端用对外域名；fileCode 走 query，与 doc.api 路由的 reqParams 取法一致） */
export function buildDownloadUrl({config = {}, fileCode, name = ''} = {}) {
    const base = String(config.baseUrl || config.baseIntranetUrl || '').replace(/\/+$/, '')
    return `${base}/file/download/${encodeURIComponent(name)}?fileCode=${encodeURIComponent(fileCode)}`
}

export default {makeDocApiUploader, buildUserInfoHeader, interpretDocApiReply, buildDownloadUrl}
