// @ts-ignore
/* eslint-disable */

import {appRequest, ResponseStructure} from '@/services/request'

/** 获取PC端展示的全部应用 */
export async function getPCShowClients() {
  let ret = await appRequest('/public-bin/client/show/pc', {method: 'GET', skipErrorHandler: true})
  return ret?.data || []
}
