// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from '@/services/request'

/** 获取平台所有的角色 */
export async function getRoles() {
  let ret = await ucenterRequest('/public-bin/user-role/group/all', {method: 'GET', skipErrorHandler: true})
  return ret?.data || []
}
