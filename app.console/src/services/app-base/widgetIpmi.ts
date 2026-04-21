// @ts-ignore
/* eslint-disable */
import { ResponseStructure, appRequest as request } from '@/services/request';

/** 删除小组件 删除小组件 返回值: Default Response POST /core/widget/ipmi/delete */
export async function postCoreWidgetIpmiOpenApiDelete(
  body: {
    widgetCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/widget/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取小组件的详细信息 获取小组件全部信息结构 返回值: Default Response GET /core/widget/ipmi/detail */
export async function getCoreWidgetIpmiDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreWidgetIpmiDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Widget;
  }>('/core/widget/ipmi/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用小组件 禁用小组件 返回值: Default Response POST /core/widget/ipmi/disable */
export async function postCoreWidgetIpmiDisable(
  body: {
    widgetCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/widget/ipmi/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用小组件 启用小组件 返回值: Default Response POST /core/widget/ipmi/enable */
export async function postCoreWidgetIpmiEnable(
  body: {
    widgetCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/widget/ipmi/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 小组件列表 获取小组件列表 返回值: Default Response POST /core/widget/ipmi/list */
export async function postCoreWidgetIpmiList(
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
    data?: { total?: number; rows?: APPAPI.Widget[] };
  }>('/core/widget/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个小组件 修改单个小组件 返回值: Default Response POST /core/widget/ipmi/update */
export async function postCoreWidgetIpmiUpdate(
  body: APPAPI.Widget,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/widget/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
