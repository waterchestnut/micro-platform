// @ts-ignore
/* eslint-disable */
import { ResponseStructure, appRequest as request } from '@/services/request';

/** 添加单个应用 添加单个应用 返回值: Default Response POST /core/client/add */
export async function postCoreClientAdd(body: APPAPI.Client, options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Client;
  }>('/core/client/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
