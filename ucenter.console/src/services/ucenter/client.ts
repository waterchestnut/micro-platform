// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取接入应用列表 */
export async function getClientList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/core/client/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 添加接入应用 */
export async function addClient(params: any) {
  return ucenterRequest('/core/client/ipmi/add', {
    method: 'POST',
    data: params
  });
}

/** 修改接入应用 */
export async function updateClient(params: any) {
  return ucenterRequest('/core/client/ipmi/update', {
    method: 'POST',
    data: params
  });
}

/** 删除接入应用 */
export async function deleteClient(clientCode: string) {
  return ucenterRequest('/core/client/ipmi/delete', {
    method: 'POST',
    data: {clientCode}
  });
}

/** 启用应用 */
export async function enableClient(clientCode: string) {
  return ucenterRequest('/core/client/ipmi/enable', {
    method: 'POST',
    data: {clientCode}
  })
}

/** 禁用应用 */
export async function disableClient(clientCode: string) {
  return ucenterRequest('/core/client/ipmi/disable', {
    method: 'POST',
    data: {clientCode}
  })
}
