// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 添加单个职位 添加单个职位 返回值: Default Response POST /core/job/ipmi/add */
export async function postCoreJobIpmiAdd(body: UCENTERAPI.Job, options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.Job;
  }>('/core/job/ipmi/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除职位 删除职位 返回值: Default Response POST /core/job/ipmi/delete */
export async function postCoreJobIpmiOpenApiDelete(
  body: {
    jobCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/job/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 职位列表 获取职位列表 返回值: Default Response POST /core/job/ipmi/list */
export async function postCoreJobIpmiList(
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
    data?: { total?: number; rows?: UCENTERAPI.Job[] };
  }>('/core/job/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个职位 修改单个职位 返回值: Default Response POST /core/job/ipmi/update */
export async function postCoreJobIpmiUpdate(
  body: UCENTERAPI.Job,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/job/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
