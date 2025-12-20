// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ragRequest} from '@/services/request'

/** 获取知识库列表 */
export async function getRagInfoList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}, relativeUrl = '') {
  let ret = await ragRequest(relativeUrl || '/core/rag-info/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}

/** 添加知识库 */
export async function addRagInfo(params: any, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/add', {
    method: 'POST',
    data: params
  })
}

/** 修改知识库 */
export async function updateRagInfo(params: any, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi/update', {
    method: 'POST',
    data: params,
    params: {ragCode: params.ragCode}
  })
}

/** 删除知识库 */
export async function deleteRagInfo(ragCode: string, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi/delete', {
    method: 'POST',
    data: {ragCode}
  })
}

/** 启用知识库 */
export async function enableRagInfo(ragCode: string, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi/enable', {
    method: 'POST',
    data: {ragCode}
  })
}

/** 禁用知识库 */
export async function disableRagInfo(ragCode: string, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi/disable', {
    method: 'POST',
    data: {ragCode}
  })
}

/** 获取知识库基本信息 */
export async function getRagInfo(ragCode: string, relativeUrl = '') {
  let ret = await ragRequest(relativeUrl || '/core/rag-info/ipmi/detail', {
    method: 'GET',
    params: {ragCode}
  })

  return ret?.data
}
