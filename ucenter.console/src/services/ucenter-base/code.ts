// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 获取验证码 生成或刷新验证码 返回值: Default Response GET /core/captcha/ */
export async function getCoreCaptcha(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getCoreCaptchaParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { image?: string; key?: string };
  }>('/core/captcha/', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}
