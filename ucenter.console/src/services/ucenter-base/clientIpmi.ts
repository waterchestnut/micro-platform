// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 添加单个客户端 添加单个客户端 返回值: Default Response POST /core/client/ipmi/add */
export async function postCoreClientIpmiAdd(
  body: UCENTERAPI.Client,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.Client;
  }>('/core/client/ipmi/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除客户端 删除客户端 返回值: Default Response POST /core/client/ipmi/delete */
export async function postCoreClientIpmiOpenApiDelete(
  body: {
    clientCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/client/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取客户端的详细信息 获取客户端全部信息结构 返回值: Default Response GET /core/client/ipmi/detail */
export async function getCoreClientIpmiDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getCoreClientIpmiDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.Client;
  }>('/core/client/ipmi/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 客户端列表 获取客户端列表 返回值: Default Response POST /core/client/ipmi/list */
export async function postCoreClientIpmiList(
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
    data?: { total?: number; rows?: UCENTERAPI.Client[] };
  }>('/core/client/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个客户端 修改单个客户端 返回值: Default Response POST /core/client/ipmi/update */
export async function postCoreClientIpmiUpdate(
  body: UCENTERAPI.Client,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/client/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
