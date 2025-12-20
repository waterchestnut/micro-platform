// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 添加单个用户 添加单个用户 返回值: Default Response POST /core/user/ipmi/add */
export async function postCoreUserIpmiAdd(
  body: UCENTERAPI.UserInfo,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfo;
  }>('/core/user/ipmi/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除用户 删除用户 返回值: Default Response POST /core/user/ipmi/delete */
export async function postCoreUserIpmiOpenApiDelete(
  body: {
    userCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取用户的详细信息 获取用户全部信息结构 返回值: Default Response GET /core/user/ipmi/detail */
export async function getCoreUserIpmiDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getCoreUserIpmiDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfo;
  }>('/core/user/ipmi/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 用户列表 获取用户列表 返回值: Default Response POST /core/user/ipmi/list */
export async function postCoreUserIpmiList(
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
    data?: { total?: number; rows?: UCENTERAPI.UserInfo[] };
  }>('/core/user/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个用户 修改单个用户 返回值: Default Response POST /core/user/ipmi/update */
export async function postCoreUserIpmiUpdate(
  body: UCENTERAPI.UserInfo,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
