/**
 * @fileOverview sse相关的数据处理
 * @author xianyang
 * @module
 */

/**
 * @description 格式化SSE字符串输出
 * @param {Object} chunk 输出片段对象
 * @param {String} chunk.id SSE的id
 * @param {String} chunk.data SSE的data
 * @param {String} chunk.event SSE的event
 * @param {String} chunk.retry SSE的retry
 * @param {String} chunk.comment SSE的comment
 * @returns {String} HTTP输出字符串
 */
export function serializeSSEEvent(chunk) {
    let payload = ''
    if (chunk.id) {
        payload += `id:${chunk.id}\n`
    }
    if (chunk.event) {
        payload += `event:${chunk.event}\n`
    }
    if (chunk.data) {
        for (const line of chunk.data.split('\n')) {
            payload += `data:${line}\n`
        }
    }
    if (chunk.retry) {
        payload += `retry:${chunk.retry}\n`
    }
    if (chunk.comment) {
        payload += `:${chunk.comment}\n`
    }
    if (!payload) {
        return ''
    }
    payload += '\n'
    return payload
}