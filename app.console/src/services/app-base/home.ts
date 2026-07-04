// @ts-ignore
/* eslint-disable */
import { ResponseStructure, appRequest as request } from '@/services/request';

/** 添加首页应用 添加应用到用户首页 返回值: Default Response POST /core/home/client/add */
export async function postCoreHomeClientAdd(
  body: {
    clientCode: string;
    homeEndpoint?: string;
    order?: number;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.HomeClient;
  }>('/core/home/client/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 批量保存首页应用 批量保存用户首页应用 返回值: Default Response POST /core/home/client/batch/save */
export async function postCoreHomeClientBatchSave(
  body: {
    clientCodes: string[];
    homeEndpoint?: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.HomeClient[];
  }>('/core/home/client/batch/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 首页应用列表 获取用户首页应用列表 GET /core/home/client/list */
export async function getCoreHomeClientList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreHomeClientListParams,
  options?: { [key: string]: any },
) {
  return request<any>('/core/home/client/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 移除首页应用 从用户首页移除应用 返回值: Default Response POST /core/home/client/remove */
export async function postCoreHomeClientRemove(
  body: {
    clientCode: string;
    homeEndpoint?: string;
    order?: number;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/home/client/remove', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加首页小组件 添加小组件到用户首页 返回值: Default Response POST /core/home/widget/add */
export async function postCoreHomeWidgetAdd(
  body: {
    widgetCode: string;
    homeEndpoint?: string;
    order?: number;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.HomeWidget;
  }>('/core/home/widget/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 批量保存首页小组件 批量保存用户首页小组件 返回值: Default Response POST /core/home/widget/batch/save */
export async function postCoreHomeWidgetBatchSave(
  body: {
    widgetCodes: string[];
    homeEndpoint?: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.HomeWidget[];
  }>('/core/home/widget/batch/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 首页小组件列表 获取用户首页小组件列表 GET /core/home/widget/list */
export async function getCoreHomeWidgetList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreHomeWidgetListParams,
  options?: { [key: string]: any },
) {
  return request<any>('/core/home/widget/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 移除首页小组件 从用户首页移除小组件 返回值: Default Response POST /core/home/widget/remove */
export async function postCoreHomeWidgetRemove(
  body: {
    widgetCode: string;
    homeEndpoint?: string;
    order?: number;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/home/widget/remove', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
