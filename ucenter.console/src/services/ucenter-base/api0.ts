// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 根路径测试 some data 返回值: Default Response GET / */
export async function get(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfo;
  }>('/', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 更新用户的 groupCodes（角色数组） 更新用户角色 返回值: 请求失败 POST /core/user/ipmi/updateRole */
export async function postCoreUserIpmiUpdateRole(
  body: {
    userCode: string;
    /** 用户的新角色列表 */
    roles: string[];
  },
  options?: { [key: string]: any },
) {
  return request<{ code?: number; msg?: string }>('/core/user/ipmi/updateRole', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 此处后端没有提供注释 GET /example/${param0} */
export async function getExampleId(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: UCENTERAPI.getExampleIdParams,
  options?: { [key: string]: any },
) {
  const { id: param0, ...queryParams } = params;
  return request<any>(`/example/${param0}`, {
    method: 'GET',
    params: { ...queryParams },
    ...(options || {}),
  });
}
