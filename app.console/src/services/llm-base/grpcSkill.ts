// @ts-ignore
/* eslint-disable */
import { ResponseStructure, llmRequest as request } from '@/services/request';

/** 添加单个远程技能 添加单个远程技能 返回值: Default Response POST /core/grpc-skill/add */
export async function postCoreGrpcSkillAdd(
  body: LLMAPI.GrpcSkill,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: LLMAPI.GrpcSkill;
  }>('/core/grpc-skill/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
