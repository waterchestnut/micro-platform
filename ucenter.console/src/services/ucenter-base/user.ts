// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 当前登录用户信息 当前用户信息接口，可通过此接口验证token是否有效 返回值: Default Response GET /core/user/cur */
export async function getCoreUserCur(options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfoWithToken;
  }>('/core/user/cur', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 更换登录邮箱 更换登录邮箱 返回值: Default Response POST /core/user/cur/email */
export async function postCoreUserCurEmail(
  body: {
    /** 新邮箱 */
    email: string;
    /** 邮箱验证码 */
    emailCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/cur/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 更换登录手机号 更换登录手机号 返回值: Default Response POST /core/user/cur/mobile */
export async function postCoreUserCurMobile(
  body: {
    /** 新手机号 */
    mobile: string;
    /** 短信验证码 */
    smsCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/cur/mobile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改个人信息 修改个人信息 返回值: Default Response POST /core/user/cur/profile */
export async function postCoreUserCurProfile(
  body: {
    /** 真实姓名 */
    realName?: string;
    /** 昵称 */
    nickName?: string;
    /** 头像URL */
    avatarUrl?: string;
    /** 民族 */
    nation?: string;
    /** 政治面貌 */
    politics?: string;
    /** 生日，格式：YYYY-MM-DD */
    birthday?: string;
    /** 性别：0-未定义, 1-男性, 2-女性 */
    gender?: 0 | 1 | 2;
    /** 学历：0-未设置, 1-专科, 2-本科, 3-硕士, 4-博士 */
    degree?: 0 | 1 | 2 | 3 | 4;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/cur/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
