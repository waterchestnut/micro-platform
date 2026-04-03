// @ts-ignore
/* eslint-disable */
import { ResponseStructure, llmRequest as request } from '@/services/request';

/** 删除远程技能 删除远程技能 返回值: Default Response POST /core/grpc-skill-my/delete */
export async function postCoreGrpcSkillMyOpenApiDelete(
  body: {
    skillCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/grpc-skill-my/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取远程技能的详细信息 获取远程技能全部信息结构 返回值: Default Response GET /core/grpc-skill-my/detail */
export async function getCoreGrpcSkillMyDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: LLMAPI.getCoreGrpcSkillMyDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: LLMAPI.GrpcSkill;
  }>('/core/grpc-skill-my/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用远程技能 禁用远程技能 返回值: Default Response POST /core/grpc-skill-my/disable */
export async function postCoreGrpcSkillMyDisable(
  body: {
    skillCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/grpc-skill-my/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用远程技能 启用远程技能 返回值: Default Response POST /core/grpc-skill-my/enable */
export async function postCoreGrpcSkillMyEnable(
  body: {
    skillCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/grpc-skill-my/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 我的远程技能列表 获取我创建的远程技能列表 返回值: Default Response POST /core/grpc-skill-my/list */
export async function postCoreGrpcSkillMyList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any> };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { total?: number; rows?: LLMAPI.GrpcSkill[] };
  }>('/core/grpc-skill-my/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改远程技能 修改远程技能 返回值: Default Response POST /core/grpc-skill-my/update */
export async function postCoreGrpcSkillMyUpdate(
  body: LLMAPI.GrpcSkill,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/grpc-skill-my/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
