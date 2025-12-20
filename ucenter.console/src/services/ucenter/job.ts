// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取职位列表 */
export async function getJobList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/core/job/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 添加职位 */
export async function addJob(params: any) {
  return ucenterRequest('/core/job/ipmi/add', {
    method: 'POST',
    data: params
  });
}

/** 修改职位 */
export async function updateJob(params: any) {
  return ucenterRequest('/core/job/ipmi/update', {
    method: 'POST',
    data: params
  });
}

/** 删除职位 */
export async function deleteJob(jobCode: string) {
  return ucenterRequest('/core/job/ipmi/delete', {
    method: 'POST',
    data: {jobCode}
  });
}
