// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ragRequest} from '@/services/request'

/** 获取材料分段列表 */
export async function getRagSegmentList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions & {
  withChunk?: number
} = {}, relativeUrl = '', ragCode: string) {
  let ret = await ragRequest(relativeUrl || '/core/rag-info/ipmi-segment/list', {
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

/** 添加材料分段 */
export async function addRagSegment(params: any, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-segment/add', {
    method: 'POST',
    data: params,
    params: {ragCode: params.ragCode}
  })
}

/** 修改材料分段 */
export async function updateRagSegment(params: any, relativeUrl = '') {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-segment/update', {
    method: 'POST',
    data: params,
    params: {ragCode: params.ragCode}
  })
}

/** 删除材料分段 */
export async function deleteRagSegment(ragSegmentCode: string, relativeUrl = '', ragCode: string) {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-segment/delete', {
    method: 'POST',
    data: {ragSegmentCode},
    params: {ragCode}
  })
}

/** 启用材料分段 */
export async function enableRagSegment(ragSegmentCode: string, relativeUrl = '', ragCode: string) {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-segment/enable', {
    method: 'POST',
    data: {ragSegmentCode},
    params: {ragCode}
  })
}

/** 禁用材料分段 */
export async function disableRagSegment(ragSegmentCode: string, relativeUrl = '', ragCode: string) {
  return ragRequest(relativeUrl || '/core/rag-info/ipmi-segment/disable', {
    method: 'POST',
    data: {ragSegmentCode},
    params: {ragCode}
  })
}

/** 获取材料分段基本信息 */
export async function getRagSegment(ragSegmentCode: string, relativeUrl = '', ragCode: string) {
  let ret = await ragRequest(relativeUrl || '/core/rag-info/ipmi-segment/detail', {
    method: 'GET',
    params: {ragSegmentCode, ragCode}
  })

  return ret?.data
}
