// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ragRequest} from '@/services/request'

/** 获取材料分句列表 */
export async function getRagChunkList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}, relativeUrl = '', ragCode: string) {
  let ret = await ragRequest(relativeUrl || '/core/rag-info/ipmi-chunk/list', {
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

/** 添加材料分句 */
export async function addRagChunk(params: any, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-chunk/add', {
    method: 'POST',
    data: params,
    params: {ragCode: params.ragCode}
  })
}

/** 修改材料分句 */
export async function updateRagChunk(params: any, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-chunk/update', {
    method: 'POST',
    data: params,
    params: {ragCode: params.ragCode}
  })
}

/** 删除材料分句 */
export async function deleteRagChunk(ragChunkCode: string, relativeUrl = '', ragCode: string) {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-chunk/delete', {
    method: 'POST',
    data: {ragChunkCode},
    params: {ragCode}
  })
}

/** 启用材料分句 */
export async function enableRagChunk(ragChunkCode: string, relativeUrl = '', ragCode: string) {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-chunk/enable', {
    method: 'POST',
    data: {ragChunkCode},
    params: {ragCode}
  })
}

/** 禁用材料分句 */
export async function disableRagChunk(ragChunkCode: string, relativeUrl = '', ragCode: string) {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-chunk/disable', {
    method: 'POST',
    data: {ragChunkCode},
    params: {ragCode}
  })
}

/** 获取材料分句基本信息 */
export async function getRagChunk(ragChunkCode: string, relativeUrl = '', ragCode: string) {
  let ret = await ragRequest(relativeUrl || '/core/rag-info/ipmi-chunk/detail', {
    method: 'GET',
    params: {ragChunkCode, ragCode}
  })

  return ret?.data
}
