// @ts-ignore
/* eslint-disable */
import { ResponseStructure, appRequest as request } from '@/services/request';

/** 删除小组件 删除小组件 返回值: Default Response POST /core/widget-my/delete */
export async function postCoreWidgetMyOpenApiDelete(
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
  }>('/core/widget-my/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取小组件的详细信息 获取小组件全部信息结构 返回值: Default Response GET /core/widget-my/detail */
export async function getCoreWidgetMyDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreWidgetMyDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Widget;
  }>('/core/widget-my/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用小组件 禁用小组件 返回值: Default Response POST /core/widget-my/disable */
export async function postCoreWidgetMyDisable(
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
  }>('/core/widget-my/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用小组件 启用小组件 返回值: Default Response POST /core/widget-my/enable */
export async function postCoreWidgetMyEnable(
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
  }>('/core/widget-my/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 小组件列表 获取我创建的小组件列表 返回值: Default Response POST /core/widget-my/list */
export async function postCoreWidgetMyList(
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
  }>('/core/widget-my/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个小组件 修改单个小组件 返回值: Default Response POST /core/widget-my/update */
export async function postCoreWidgetMyUpdate(
  body: APPAPI.Widget,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/widget-my/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
