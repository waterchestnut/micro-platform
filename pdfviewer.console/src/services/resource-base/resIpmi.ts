// @ts-ignore
/* eslint-disable */
import { ResponseStructure, resourceRequest as request } from '@/services/request';

/** 删除资源 删除资源 返回值: Default Response POST /core/res-info/ipmi/delete */
export async function postCoreResInfoIpmiOpenApiDelete(
  body: {
    resCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/res-info/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取资源的详细信息 获取资源全部信息结构 返回值: Default Response GET /core/res-info/ipmi/detail */
export async function getCoreResInfoIpmiDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RESOURCEAPI.getCoreResInfoIpmiDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RESOURCEAPI.ResInfo;
  }>('/core/res-info/ipmi/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 资源列表 获取资源列表 返回值: Default Response POST /core/res-info/ipmi/list */
export async function postCoreResInfoIpmiList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any> };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { total?: number; rows?: RESOURCEAPI.ResInfo[] };
  }>('/core/res-info/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个资源 修改单个资源 返回值: Default Response POST /core/res-info/ipmi/update */
export async function postCoreResInfoIpmiUpdate(
  body: RESOURCEAPI.ResInfo,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/res-info/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
