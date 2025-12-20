// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 用户登录 用户名、密码方式登录 返回值: Default Response POST /core/user/auth/login */
export async function postCoreUserAuthLogin(
  body: {
    username: string;
    pwd: string;
    captchaKey: string;
    captcha: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfoWithToken;
  }>('/core/user/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取加密的公钥 获取密码加密的公钥 返回值: Default Response GET /core/user/auth/rsa-public-key */
export async function getCoreUserAuthRsaPublicKey(options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: string;
  }>('/core/user/auth/rsa-public-key', {
    method: 'GET',
    ...(options || {}),
  });
}
