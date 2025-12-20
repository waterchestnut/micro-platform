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
