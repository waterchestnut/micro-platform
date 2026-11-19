/**
 * @fileOverview doc.api 附件文本提取的接线件（executeReadAttachmentTool 的生产 deps）
 * @module services/core/attachment/docApiExtract
 * @description
 * `POST {baseIntranetUrl}/file/extract/text {fileCode}` → `{code:0, data:{text,docType,viaOcr,truncated}}`
 * （doc.api routes/file/root.js:8 既有面，供 AI 判分附件题用过——不是新造的接口）。
 * 身份头与存在性核验同构（docApiUpload.buildUserInfoHeader，内网直连信任链）；
 * code 非 0 ⇒ 抛（executeReadAttachmentTool 的 catch 会把它变成模型可见的如实错误，
 * doc.api 失败响应 statusCode 仍是 200，**只看 code 字段**，别看状态码下结论）。
 */
import {buildUserInfoHeader} from '../artifact/docApiUpload.js'

/**
 * @description 造 extractText deps（fetchImpl 注入位=离线测试）
 * @param {Object} params
 * @param {Object} params.docApiConfig {baseIntranetUrl, timeoutMs}
 * @param {Object} params.userInfo {userCode, realName}
 * @param {Function} [params.fetchImpl] 注入 fetch
 * @returns {Function} async (fileCode) => {text, docType, viaOcr, truncated}
 * @throws {Error} 配置缺失 / code 非 0 / 网络异常（调用方兜成工具错误话）
 */
export function makeExtractDeps({docApiConfig = {}, userInfo = {}, fetchImpl} = {}) {
    const doFetch = fetchImpl || ((...a) => fetch(...a))
    return async (fileCode) => {
        const base = docApiConfig.baseIntranetUrl || ''
        if (!base) throw new Error('docApiConfig.baseIntranetUrl 未配置，附件提取无从发起')
        if (!fileCode) throw new Error('extractText: fileCode 必填')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), docApiConfig.timeoutMs || 60000)
        try {
            const r = await doFetch(`${base}/file/extract/text`, {
                method: 'POST',
                headers: {'content-type': 'application/json', 'user-info': buildUserInfoHeader(userInfo)},
                body: JSON.stringify({fileCode}),
                signal: controller.signal,
            })
            const j = await r.json().catch(() => null)
            if (!j || j.code !== 0) {
                throw new Error(`doc.api 附件提取失败: code=${j?.code ?? '-'} ${String(j?.message || '').slice(0, 200)}`)
            }
            return j.data || {text: ''}
        } finally {
            clearTimeout(timer)
        }
    }
}

export default {makeExtractDeps}
