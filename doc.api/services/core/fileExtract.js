/**
 * @fileOverview 按文件提取纯文本（对接 rag pyserver/transform Extractor；供 AI 判分附件题等场景）
 * @module
 */
import {getFileObject} from './fileInfo.js'
import {pdf2Text, word2Text, excel2Text, html2Text, image2Text} from '../../grpc/clients/extractor.js'

const MAX_BYTES = 30 * 1024 * 1024 // 30MB
const MAX_TEXT = 40000

async function streamToBuffer(stream) {
    const chunks = []
    let size = 0
    for await (const chunk of stream) {
        size += chunk.length
        if (size > MAX_BYTES) {
            stream.destroy && stream.destroy()
            throw new Error('文件过大（超过30MB），无法提取文本')
        }
        chunks.push(chunk)
    }
    return Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c)))
}

function extOf(fileName = '', mimetype = '') {
    const m = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/)
    if (m) return m[1]
    const mimeMap = {
        'application/pdf': 'pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-excel': 'xls',
        'text/csv': 'csv',
        'text/html': 'html',
        'text/plain': 'txt',
        'text/markdown': 'md',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/bmp': 'bmp',
        'image/webp': 'webp',
    }
    return mimeMap[String(mimetype).toLowerCase()] || ''
}

/**
 * 按 fileCode 提取文本
 * @returns {Promise<{text: string, docType: string, viaOcr: boolean}>}
 */
export async function extractTextByFileCode(fileCode) {
    const {fileInfo, fileStream} = await getFileObject(fileCode)
    const buffer = await streamToBuffer(fileStream)
    const docType = extOf(fileInfo.fileName, fileInfo.mimetype)

    let text = ''
    let viaOcr = false
    switch (docType) {
        case 'pdf': {
            text = await pdf2Text(buffer, '')
            if (!String(text).trim()) {
                // 扫描件兜底：OCR 模式重提
                viaOcr = true
                text = await pdf2Text(buffer, 'ocr')
            }
            break
        }
        case 'docx':
            text = await word2Text(buffer)
            break
        case 'xlsx':
            text = await excel2Text(buffer, '')
            break
        case 'xls':
            text = await excel2Text(buffer, 'xls')
            break
        case 'csv':
            text = await excel2Text(buffer, 'csv')
            break
        case 'html':
        case 'htm':
            text = await html2Text(buffer)
            break
        case 'txt':
        case 'md':
        case 'json':
            text = buffer.toString('utf8')
            break
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
        case 'bmp':
        case 'webp':
            viaOcr = true
            text = await image2Text(buffer)
            break
        case 'doc':
            throw new Error('暂不支持老版 .doc，请另存为 .docx 后上传')
        default:
            throw new Error(`暂不支持该附件类型提取文本: ${docType || fileInfo.mimetype || '未知'}`)
    }

    text = String(text || '')
    return {text: text.slice(0, MAX_TEXT), docType: docType || 'unknown', viaOcr, truncated: text.length > MAX_TEXT}
}

export default {extractTextByFileCode}
