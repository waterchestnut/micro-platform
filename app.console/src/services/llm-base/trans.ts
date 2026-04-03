// @ts-ignore
/* eslint-disable */
import { ResponseStructure, llmRequest as request } from '@/services/request';

/** 大模型文本翻译 调用大模型自动检测语言并翻译原文 返回值: Default Response POST /core/trans/llm/auto */
export async function postCoreTransLlmAuto(
  body: {
    /** 原文 */
    sourceText?: string;
    options?: { sourceLanguage?: string; targetLanguage?: string };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { transText?: string };
  }>('/core/trans/llm/auto', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 大模型图片翻译 调用大模型自动识别图片中的文本并翻译 返回值: Default Response POST /core/trans/llm/picture */
export async function postCoreTransLlmPicture(
  body: {
    /** 图片链接 */
    imgUrl?: string;
    options?: { sourceLanguage?: string; targetLanguage?: string };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { ocr?: string; trans?: string };
  }>('/core/trans/llm/picture', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
