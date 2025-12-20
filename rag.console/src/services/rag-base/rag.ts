// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ragRequest as request } from '@/services/request';

/** 添加单个知识库 添加单个知识库 返回值: Default Response POST /core/rag-info/add */
export async function postCoreRagInfoAdd(body: RAGAPI.RagInfo, options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagInfo;
  }>('/core/rag-info/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
