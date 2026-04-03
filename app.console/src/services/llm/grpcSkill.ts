// @ts-ignore
/* eslint-disable */

import {ResponseStructure, llmRequest} from '@/services/request'

/** 获取大模型技能列表 */
export async function getGrpcSkillList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}, relativeUrl = '') {
  let ret = await llmRequest(relativeUrl || '/core/grpc-skill/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}

/** 添加大模型技能 */
export async function addGrpcSkill(params: any, relativeUrl = '') {
  return llmRequest(relativeUrl || '/core/grpc-skill/add', {
    method: 'POST',
    data: params
  })
}

/** 修改大模型技能 */
export async function updateGrpcSkill(params: any, relativeUrl = '') {
  return llmRequest(relativeUrl || '/core/grpc-skill/ipmi/update', {
    method: 'POST',
    data: params,
    params: {skillCode: params.skillCode}
  })
}

/** 删除大模型技能 */
export async function deleteGrpcSkill(skillCode: string, relativeUrl = '') {
  return llmRequest(relativeUrl || '/core/grpc-skill/ipmi/delete', {
    method: 'POST',
    data: {skillCode}
  })
}

/** 启用大模型技能 */
export async function enableGrpcSkill(skillCode: string, relativeUrl = '') {
  return llmRequest(relativeUrl || '/core/grpc-skill/ipmi/enable', {
    method: 'POST',
    data: {skillCode}
  })
}

/** 禁用大模型技能 */
export async function disableGrpcSkill(skillCode: string, relativeUrl = '') {
  return llmRequest(relativeUrl || '/core/grpc-skill/ipmi/disable', {
    method: 'POST',
    data: {skillCode}
  })
}

/** 获取大模型技能基本信息 */
export async function getGrpcSkill(skillCode: string, relativeUrl = '') {
  let ret = await llmRequest(relativeUrl || '/core/grpc-skill/ipmi/detail', {
    method: 'GET',
    params: {skillCode}
  })

  return ret?.data
}
