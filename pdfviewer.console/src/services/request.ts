import {request} from '@umijs/max';

// 与后端约定的响应数据格式
export interface ResponseStructure {
  statusCode: number;
  code: number;
  data?: any;
  msg?: string;
  errorLevel?: string;
}

export async function ucenterRequest<T>(relativeUrl: string, options?: { [key: string]: any }) {
  // @ts-ignore
  const url = UCENTER_API_BASE + relativeUrl;
  return request<ResponseStructure & T>(url, {...options});
}

export async function llmRequest<T>(relativeUrl: string, options?: { [key: string]: any }) {
  // @ts-ignore
  const url = LLM_API_BASE + relativeUrl
  return request<ResponseStructure & T>(url, {...options})
}

export async function resourceRequest<T>(relativeUrl: string, options?: { [key: string]: any }) {
  // @ts-ignore
  const url = RESOURCE_API_BASE + relativeUrl
  return request<ResponseStructure & T>(url, {...options})
}

export async function docRequest<T>(relativeUrl: string, options?: { [key: string]: any }) {
  // @ts-ignore
  const url = DOC_API_BASE + relativeUrl
  return request<ResponseStructure & T>(url, {...options})
}
