// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ragRequest} from '@/services/request'

/** 获取知识库材料列表 */
export async function getRagMaterialList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}, relativeUrl = '', ragCode: string) {
  let ret = await ragRequest(relativeUrl || '/core/rag-info/ipmi-material/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options},
    params: {ragCode}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}

/** 添加知识库材料 */
export async function addRagMaterial(params: any, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-material/add', {
    method: 'POST',
    data: params,
    params: {ragCode: params.ragCode}
  })
}

/** 修改知识库材料 */
export async function updateRagMaterial(params: any, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-material/update', {
    method: 'POST',
    data: params,
    params: {ragCode: params.ragCode}
  })
}

/** 删除知识库材料 */
export async function deleteRagMaterial(ragMaterialCode: string, relativeUrl = '', ragCode: string) {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-material/delete', {
    method: 'POST',
    data: {ragMaterialCode},
    params: {ragCode}
  })
}

/** 启用知识库材料 */
export async function enableRagMaterial(ragMaterialCode: string, relativeUrl = '', ragCode: string) {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-material/enable', {
    method: 'POST',
    data: {ragMaterialCode},
    params: {ragCode}
  })
}

/** 禁用知识库材料 */
export async function disableRagMaterial(ragMaterialCode: string, relativeUrl = '', ragCode: string) {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-material/disable', {
    method: 'POST',
    data: {ragMaterialCode},
    params: {ragCode}
  })
}

/** 获取知识库材料基本信息 */
export async function getRagMaterial(ragMaterialCode: string, relativeUrl = '', ragCode: string) {
  let ret = await ragRequest(relativeUrl || '/core/rag-info/ipmi-material/detail', {
    method: 'GET',
    params: {ragMaterialCode, ragCode}
  })

  return ret?.data
}
