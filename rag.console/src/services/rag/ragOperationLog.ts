import {ragRequest} from '@/services/request'

export async function getOperationLogList(ragCode: string, pageIndex = 1, pageSize = 20, logType?: string, relativeUrl = '') {
  let ret = await ragRequest(relativeUrl || '/core/rag-info/ipmi-log/list', {
    method: 'POST',
    data: {ragCode, logType, pageIndex, pageSize}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0, rows: []}
  }
}
