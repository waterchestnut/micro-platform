// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取部门列表 */
export async function getDepartmentList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/core/department/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 添加部门 */
export async function addDepartment(params: any) {
  return ucenterRequest('/core/department/ipmi/add', {
    method: 'POST',
    data: params
  });
}

/** 修改部门 */
export async function updateDepartment(params: any) {
  return ucenterRequest('/core/department/ipmi/update', {
    method: 'POST',
    data: params
  });
}

/** 删除部门 */
export async function deleteDepartment(departmentCode: string) {
  return ucenterRequest('/core/department/ipmi/delete', {
    method: 'POST',
    data: {departmentCode}
  });
}
