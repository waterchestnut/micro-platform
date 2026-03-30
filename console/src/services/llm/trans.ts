/**
 * @fileOverview 翻译相关的接口调用
 * @author xianyang 2025/11/6
 * @module
 */

import {llmRequest} from '@/services/request'

/** 翻译文本 */
export async function execTransText(sourceText: string): Promise<string> {
  let ret = await llmRequest('/core/trans/llm/auto', {
    method: 'POST',
    data: {sourceText}
  })

  return ret?.data?.transText || ''
}

/** 翻译图片 */
export async function execTransPicture(imgUrl: string): Promise<{ ocr: string, trans: string }> {
  let ret = await llmRequest('/core/trans/llm/picture', {
    method: 'POST',
    data: {imgUrl}
  })

  return ret?.data || {ocr: '未识别', trans: '未识别'}
}
