/**
 * @fileOverview openai相关的工具方法
 * @author xianyang 2025/6/19
 * @module
 */
import {get_encoding, encoding_for_model} from 'tiktoken'

/*计算文本的Token数量*/
export function calcTextTokenCount(text) {
    const enc = get_encoding('cl100k_base')
    const count = enc.encode(text).length
    enc.free()
    return count
}