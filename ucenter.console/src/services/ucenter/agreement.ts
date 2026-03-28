// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 获取协议列表 */
export async function getAgreementList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/core/agreement/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  });
  if (ret.code === 0) {
    return ret.data;
  } else {
    return {total: 0};
  }
}

/** 添加协议 */
export async function addAgreement(params: any) {
  return ucenterRequest('/core/agreement/ipmi/add', {
    method: 'POST',
    data: params
  });
}

/** 修改协议 */
export async function updateAgreement(params: any) {
  return ucenterRequest('/core/agreement/ipmi/update', {
    method: 'POST',
    data: params
  });
}

/** 删除协议 */
export async function deleteAgreement(agreementCode: string) {
  return ucenterRequest('/core/agreement/ipmi/delete', {
    method: 'POST',
    data: {agreementCode}
  });
}
