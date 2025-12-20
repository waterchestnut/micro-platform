// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 添加单个部门 添加单个部门 返回值: Default Response POST /core/department/ipmi/add */
export async function postCoreDepartmentIpmiAdd(
  body: UCENTERAPI.Department,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.Department;
  }>('/core/department/ipmi/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除部门 删除部门 返回值: Default Response POST /core/department/ipmi/delete */
export async function postCoreDepartmentIpmiOpenApiDelete(
  body: {
    departmentCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/department/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 部门列表 获取部门列表 返回值: Default Response POST /core/department/ipmi/list */
export async function postCoreDepartmentIpmiList(
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
    data?: { total?: number; rows?: UCENTERAPI.Department[] };
  }>('/core/department/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个部门 修改单个部门 返回值: Default Response POST /core/department/ipmi/update */
export async function postCoreDepartmentIpmiUpdate(
  body: UCENTERAPI.Department,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/department/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
