// @ts-ignore
/* eslint-disable */
import { ResponseStructure, resourceRequest as request } from '@/services/request';

/** 添加单个资源 添加单个资源 返回值: Default Response POST /core/res-info/add */
export async function postCoreResInfoAdd(
  body: RESOURCEAPI.ResInfo,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RESOURCEAPI.ResInfo;
  }>('/core/res-info/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
