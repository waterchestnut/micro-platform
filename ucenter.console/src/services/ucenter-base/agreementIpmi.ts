// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 添加协议 添加协议 返回值: Default Response POST /core/agreement/ipmi/add */
export async function postCoreAgreementIpmiAdd(
  body: {
    /** 协议标识 */
    agreementCode?: string;
    /** 协议标题 */
    title?: string;
    /** 协议内容 */
    content?: string;
    /** 协议类型 */
    type?: 1 | 2;
    /** 协议版本号 */
    version?: number;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 生效时间 */
    effectiveTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: {
      agreementCode?: string;
      title?: string;
      content?: string;
      type?: 1 | 2;
      version?: number;
      status?: -1 | 0 | 1;
      effectiveTime?: string;
    };
  }>('/core/agreement/ipmi/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除协议 删除协议 返回值: Default Response POST /core/agreement/ipmi/delete */
export async function postCoreAgreementIpmiOpenApiDelete(
  body: {
    agreementCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/agreement/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取协议详情 获取协议详情 返回值: Default Response GET /core/agreement/ipmi/detail */
export async function getCoreAgreementIpmiDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getCoreAgreementIpmiDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: {
      agreementCode?: string;
      title?: string;
      content?: string;
      type?: 1 | 2;
      version?: number;
      status?: -1 | 0 | 1;
      effectiveTime?: string;
    };
  }>('/core/agreement/ipmi/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 协议列表 获取协议列表 返回值: Default Response POST /core/agreement/ipmi/list */
export async function postCoreAgreementIpmiList(
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
    data?: {
      total?: number;
      rows?: {
        agreementCode?: string;
        title?: string;
        content?: string;
        type?: 1 | 2;
        version?: number;
        status?: -1 | 0 | 1;
        effectiveTime?: string;
      }[];
    };
  }>('/core/agreement/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改协议 修改协议 返回值: Default Response POST /core/agreement/ipmi/update */
export async function postCoreAgreementIpmiUpdate(
  body: {
    /** 协议标识 */
    agreementCode?: string;
    /** 协议标题 */
    title?: string;
    /** 协议内容 */
    content?: string;
    /** 协议类型 */
    type?: 1 | 2;
    /** 协议版本号 */
    version?: number;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 生效时间 */
    effectiveTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/agreement/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
