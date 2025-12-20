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
