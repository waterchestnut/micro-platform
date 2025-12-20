// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 客户端请求授权 客户端请求授权 返回值: Default Response GET /oauth/authorize */
export async function getOauthAuthorize(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getOauthAuthorizeParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { authCode?: string; state?: string };
  }>('/oauth/authorize', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 客户端请求统一退出登录 客户端请求统一退出登录 返回值: Default Response GET /oauth/logout */
export async function getOauthLogout(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getOauthLogoutParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { authCode?: string; state?: string };
  }>('/oauth/logout', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}
