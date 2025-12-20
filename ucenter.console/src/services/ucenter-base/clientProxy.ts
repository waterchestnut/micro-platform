// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 测试接口 测试接口 返回值: Default Response GET /client-proxy/ */
export async function getClientProxy(options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { test?: string };
  }>('/client-proxy/', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 跳转到用户中心登录 跳转到用户中心登录 返回值: Default Response GET /client-proxy/oauth/authorize */
export async function getClientProxyOauthAuthorize(options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/client-proxy/oauth/authorize', {
    method: 'GET',
    ...(options || {}),
  });
}

/** OAuth登录回调接口 OAuth登录回调接口 返回值: Default Response GET /client-proxy/oauth/callback */
export async function getClientProxyOauthCallback(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getClientProxyOauthCallbackParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/client-proxy/oauth/callback', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 跳转到用户中心注销 跳转到用户中心注销 返回值: Default Response GET /client-proxy/oauth/logout */
export async function getClientProxyOauthLogout(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getClientProxyOauthLogoutParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/client-proxy/oauth/logout', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 统一登录注入 统一登录注入 返回值: Default Response GET /client-proxy/oauth/sign-in */
export async function getClientProxyOauthSignIn(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getClientProxyOauthSignInParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/client-proxy/oauth/sign-in', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 统一登录注销 统一登录注销 返回值: Default Response GET /client-proxy/oauth/sign-out */
export async function getClientProxyOauthSignOut(options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/client-proxy/oauth/sign-out', {
    method: 'GET',
    ...(options || {}),
  });
}
