// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ragRequest} from '@/services/request'

/** 知识库召回 */
export async function vecSearch(subject: string, options: any) {
  let ret = await ragRequest('/core/rag-search/search', {
    method: 'POST',
    data: {subject, options}
  })
  return ret.data || []
}
