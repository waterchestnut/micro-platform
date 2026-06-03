import {ucenterRequest} from '@/services/request'

export async function getDepartmentList(pageIndex = 1, pageSize = 1000, filter = {}) {
  let ret = await ucenterRequest('/core/department/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options: {sort: {orderNum: 1}}}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0, rows: []}
  }
}
