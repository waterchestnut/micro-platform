// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 检查手机号归属地 检查手机号或固定电话的归属城市 返回值: Default Response GET /public-bin/mobile-range/check */
export async function getPublicBinMobileRangeCheck(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getPublicBinMobileRangeCheckParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { provName?: string; cityName?: string };
  }>('/public-bin/mobile-range/check', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}
