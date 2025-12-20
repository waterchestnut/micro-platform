// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 接入应用获取token 接入应用获取token 返回值: Default Response POST /cgi-bin/oauth/code/token */
export async function postCgiBinOauthCodeToken(
  body: {
    clientCode: string;
    clientSecret: string;
    authCode: string;
    retUrl: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { accessToken?: string; refreshToken?: string; scopes?: string; expiresTime?: string };
  }>('/cgi-bin/oauth/code/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 接入应用获取clientToken 接入应用获取clientToken 返回值: Default Response POST /cgi-bin/oauth/pwd/client-token */
export async function postCgiBinOauthPwdClientToken(
  body: {
    clientCode: string;
    clientSecret: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { clientAccessToken?: string; clientRefreshToken?: string; expiresTime?: string };
  }>('/cgi-bin/oauth/pwd/client-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 接入应用刷新clientToken 接入应用刷新clientToken 返回值: Default Response POST /cgi-bin/oauth/pwd/client-token/refresh */
export async function postCgiBinOauthPwdClientTokenRefresh(
  body: {
    clientRefreshToken: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { clientAccessToken?: string; clientRefreshToken?: string; expiresTime?: string };
  }>('/cgi-bin/oauth/pwd/client-token/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
