// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 添加单个用户组 添加单个用户组 返回值: Default Response POST /core/group/ipmi/add */
export async function postCoreGroupIpmiAdd(
  body: UCENTERAPI.Group,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.Group;
  }>('/core/group/ipmi/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除用户组 删除用户组 返回值: Default Response POST /core/group/ipmi/delete */
export async function postCoreGroupIpmiOpenApiDelete(
  body: {
    groupCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/group/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 用户组列表 获取用户组列表 返回值: Default Response POST /core/group/ipmi/list */
export async function postCoreGroupIpmiList(
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
    data?: { total?: number; rows?: UCENTERAPI.Group[] };
  }>('/core/group/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个用户组 修改单个用户组 返回值: Default Response POST /core/group/ipmi/update */
export async function postCoreGroupIpmiUpdate(
  body: UCENTERAPI.Group,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/group/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
