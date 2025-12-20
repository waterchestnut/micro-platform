// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from '@/services/request'
import {setUserCache} from '@/utils/authority'

/** 获取当前登录用户信息 */
export async function queryCurrentUser() {
  let ret = await ucenterRequest('/core/user/cur', {
    method: 'GET',
    skipErrorHandler: true,
    headers: {'param-no-redirect': '1'}
  })
  /*始终保存用户缓存信息，用于传递给子应用*/
  setUserCache(ret?.data)
  return ret
}
