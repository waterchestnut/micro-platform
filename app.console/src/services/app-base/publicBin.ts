// @ts-ignore
/* eslint-disable */
import { ResponseStructure, appRequest as request } from '@/services/request';

/** 小程序端应用列表 获取小程序端呈现的应用列表 返回值: Default Response GET /public-bin/client/show/mini */
export async function getPublicBinClientShowMini(options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Client[];
  }>('/public-bin/client/show/mini', {
    method: 'GET',
    ...(options || {}),
  });
}

/** PC端应用列表 获取PC端呈现的应用列表 返回值: Default Response GET /public-bin/client/show/pc */
export async function getPublicBinClientShowPc(options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Client[];
  }>('/public-bin/client/show/pc', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 小程序端小组件列表 获取小程序端展示的小组件列表 返回值: Default Response GET /public-bin/widget/show/mini */
export async function getPublicBinWidgetShowMini(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getPublicBinWidgetShowMiniParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Widget[];
  }>('/public-bin/widget/show/mini', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** PC端小组件列表 获取PC端展示的小组件列表 返回值: Default Response GET /public-bin/widget/show/pc */
export async function getPublicBinWidgetShowPc(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getPublicBinWidgetShowPcParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Widget[];
  }>('/public-bin/widget/show/pc', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}
