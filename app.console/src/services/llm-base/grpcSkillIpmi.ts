// @ts-ignore
/* eslint-disable */
import { ResponseStructure, llmRequest as request } from '@/services/request';

/** 删除远程技能 删除远程技能 返回值: Default Response POST /core/grpc-skill/ipmi/delete */
export async function postCoreGrpcSkillIpmiOpenApiDelete(
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
  }>('/core/grpc-skill/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取远程技能的详细信息 获取远程技能全部信息结构 返回值: Default Response GET /core/grpc-skill/ipmi/detail */
export async function getCoreGrpcSkillIpmiDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: LLMAPI.getCoreGrpcSkillIpmiDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: LLMAPI.GrpcSkill;
  }>('/core/grpc-skill/ipmi/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用远程技能 禁用远程技能 返回值: Default Response POST /core/grpc-skill/ipmi/disable */
export async function postCoreGrpcSkillIpmiDisable(
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
  }>('/core/grpc-skill/ipmi/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用远程技能 启用远程技能 返回值: Default Response POST /core/grpc-skill/ipmi/enable */
export async function postCoreGrpcSkillIpmiEnable(
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
  }>('/core/grpc-skill/ipmi/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 远程技能列表 获取远程技能列表 返回值: Default Response POST /core/grpc-skill/ipmi/list */
export async function postCoreGrpcSkillIpmiList(
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
  }>('/core/grpc-skill/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改远程技能 修改远程技能 返回值: Default Response POST /core/grpc-skill/ipmi/update */
export async function postCoreGrpcSkillIpmiUpdate(
  body: LLMAPI.GrpcSkill,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/grpc-skill/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
