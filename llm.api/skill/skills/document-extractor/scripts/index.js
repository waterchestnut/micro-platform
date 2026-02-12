/**
 * @fileOverview Document Extractor Skill 执行脚本
 * @description 实现文档内容提取相关的自动化指令，调用 gRPC 服务
 * @module
 */

import {pdf2Text, word2Text, excel2Text, html2Text} from '../../../../grpc/clients/extractor.js'

/**
 * @description 从 URL 获取文件内容并转换为 Uint8Array
 * @param {string} url - 文件 URL
 * @returns {Promise<Uint8Array>}
 */
async function fetchFileFromUrl(url) {
    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`)
        }
        
        const arrayBuffer = await response.arrayBuffer()
        return new Uint8Array(arrayBuffer)
    } catch (error) {
        throw new Error(`获取文件失败: ${error.message}`)
    }
}

/**
 * @description 从 PDF 文档提取文本
 * @param {Object} params
 * @param {string} params.url - PDF 文件 URL
 * @param {string} [params.mode] - 可选，传入 'ocr' 启用 OCR 识别
 * @returns {Object}
 */
export async function extractFromPdf(params) {
    const { url, mode } = params
    
    if (!url) {
        throw new Error('缺少必要参数: url（文件 URL）')
    }
    
    try {
        // 从 URL 获取文件内容
        const content = await fetchFileFromUrl(url)
        
        // pdf2Text 支持 'ocr' 或不传 mode
        const modeParam = mode === 'ocr' ? 'ocr' : undefined
        
        const text = await pdf2Text(content, modeParam)
        
        return {
            success: true,
            command: 'extractFromPdf',
            format: 'PDF',
            text: text,
            length: text.length,
            ocrEnabled: mode === 'ocr',
            message: `成功从 PDF 文档提取了 ${text.length} 个字符的文本内容`
        }
    } catch (error) {
        return {
            success: false,
            command: 'extractFromPdf',
            format: 'PDF',
            error: error.message,
            message: `PDF 文本提取失败: ${error.message}`
        }
    }
}

/**
 * @description 从 Word 文档提取文本
 * @param {Object} params
 * @param {string} params.url - Word 文件 URL
 * @returns {Object}
 */
export async function extractFromWord(params) {
    const { url } = params
    
    if (!url) {
        throw new Error('缺少必要参数: url（文件 URL）')
    }
    
    try {
        // 从 URL 获取文件内容
        const content = await fetchFileFromUrl(url)
        
        // word2Text 不支持 language 参数
        const text = await word2Text(content)
        
        return {
            success: true,
            command: 'extractFromWord',
            format: 'Word',
            text: text,
            length: text.length,
            message: `成功从 Word 文档提取了 ${text.length} 个字符的文本内容`
        }
    } catch (error) {
        return {
            success: false,
            command: 'extractFromWord',
            format: 'Word',
            error: error.message,
            message: `Word 文本提取失败: ${error.message}`
        }
    }
}

/**
 * @description 从 Excel 表格提取文本
 * @param {Object} params
 * @param {string} params.url - Excel 文件 URL
 * @param {string} [params.format] - 可选，格式类型: 'xls', 'csv', 'xlsx'
 * @returns {Object}
 */
export async function extractFromExcel(params) {
    const { url, format } = params
    
    if (!url) {
        throw new Error('缺少必要参数: url（文件 URL）')
    }
    
    try {
        // 从 URL 获取文件内容
        const content = await fetchFileFromUrl(url)
        
        // excel2Text 支持 'xls', 'csv', 'xlsx' 作为 language 参数
        const formatParam = ['xls', 'csv', 'xlsx'].includes(format) ? format : undefined
        
        const text = await excel2Text(content, formatParam)
        
        return {
            success: true,
            command: 'extractFromExcel',
            format: 'Excel',
            text: text,
            length: text.length,
            detectedFormat: formatParam || 'auto',
            message: `成功从 Excel 表格提取了 ${text.length} 个字符的文本内容`
        }
    } catch (error) {
        return {
            success: false,
            command: 'extractFromExcel',
            format: 'Excel',
            error: error.message,
            message: `Excel 文本提取失败: ${error.message}`
        }
    }
}

/**
 * @description 从 HTML 页面提取文本
 * @param {Object} params
 * @param {string} params.url - HTML 文件 URL
 * @returns {Object}
 */
export async function extractFromHtml(params) {
    const { url } = params
    
    if (!url) {
        throw new Error('缺少必要参数: url（文件 URL）')
    }
    
    try {
        // 从 URL 获取文件内容
        const content = await fetchFileFromUrl(url)
        
        // html2Text 不支持 language 参数
        const text = await html2Text(content)
        
        return {
            success: true,
            command: 'extractFromHtml',
            format: 'HTML',
            text: text,
            length: text.length,
            message: `成功从 HTML 页面提取了 ${text.length} 个字符的文本内容`
        }
    } catch (error) {
        return {
            success: false,
            command: 'extractFromHtml',
            format: 'HTML',
            error: error.message,
            message: `HTML 文本提取失败: ${error.message}`
        }
    }
}

/**
 * @description 智能文档提取（自动识别格式）
 * @param {Object} params
 * @param {string} params.url - 文件 URL
 * @param {string} params.format - 文档格式（pdf, word, excel, html）
 * @param {string} [params.mode] - PDF 用 'ocr' 启用 OCR
 * @param {string} [params.subtype] - Excel 用 'xls'/'csv'/'xlsx' 指定格式
 * @returns {Object}
 */
export async function smartExtract(params) {
    const { url, format, mode, subtype } = params
    
    if (!url) {
        throw new Error('缺少必要参数: url（文件 URL）')
    }
    
    if (!format) {
        return {
            success: false,
            error: '缺少必要参数: format（请指定文档格式：pdf, word, excel, html）',
            supportedFormats: ['pdf', 'word', 'excel', 'html']
        }
    }
    
    const formatLower = format.toLowerCase()
    
    switch (formatLower) {
        case 'pdf':
            return await extractFromPdf({ url, mode })
        case 'word':
        case 'doc':
        case 'docx':
            return await extractFromWord({ url })
        case 'excel':
        case 'xls':
        case 'xlsx':
        case 'csv':
            // 对于 Excel，subtype 参数可以作为 format 传递
            return await extractFromExcel({ url, format: subtype || formatLower })
        case 'html':
        case 'htm':
            return await extractFromHtml({ url })
        default:
            return {
                success: false,
                error: `不支持的文档格式: ${format}`,
                supportedFormats: ['pdf', 'word', 'excel', 'html']
            }
    }
}

/**
 * @description 执行 Skill 命令的入口函数
 * @param {string} commandName - 命令名称
 * @param {Object} parameters - 命令参数
 * @returns {Promise<Object>}
 */
export async function executeCommand(commandName, parameters = {}) {
    switch (commandName) {
        case 'extractFromPdf':
            return await extractFromPdf(parameters)
        case 'extractFromWord':
            return await extractFromWord(parameters)
        case 'extractFromExcel':
            return await extractFromExcel(parameters)
        case 'extractFromHtml':
            return await extractFromHtml(parameters)
        case 'smartExtract':
            return await smartExtract(parameters)
        default:
            throw new Error(`未知命令: ${commandName}`)
    }
}
