// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ragRequest as request } from '@/services/request';

/** 知识库内容召回 根据输入文本，召回知识库片段 返回值: Default Response POST /core/rag-search/search */
export async function postCoreRagSearchSearch(
  body: {
    /** 查询文本 */
    subject?: string;
    options?: { maxLength?: number; ragCode?: string };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagSearchItem[];
  }>('/core/rag-search/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
