// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from '@/services/request'
import {setUserCache} from '@/utils/authority'
import {getEmbeddedProps, isEmbedded} from '@/utils/embed'

/** 获取当前登录用户信息 */
export async function queryCurrentUser() {
  if (isEmbedded()) {
    return {
      code: 0,
      data: getEmbeddedProps()?.getUserCache()
    }
  }

  let ret = await ucenterRequest('/core/user/cur', {
    method: 'GET', skipErrorHandler: true,
    headers: {'param-no-redirect': '1'}
  })
  if (process.env.NODE_ENV === 'development') {
    setUserCache(ret?.data)
  }
  return ret
}

/** 获取用户列表 */
export async function getUserList(pageIndex = 1, pageSize = 10, filter = {}, options: API.ListOptions = {}) {
  let ret = await ucenterRequest('/core/user/ipmi/list', {
    method: 'POST',
    data: {filter, pageIndex, pageSize, options}
  })
  if (ret.code === 0) {
    return ret.data
  } else {
    return {total: 0}
  }
}

/** 添加用户 */
export async function addUser(params: any) {
  return ucenterRequest('/core/user/ipmi/add', {
    method: 'POST',
    data: params
  })
}

/** 修改用户 */
export async function updateUser(params: any) {
  return ucenterRequest('/core/user/ipmi/update', {
    method: 'POST',
    data: params
  })
}

/** 删除用户 */
export async function deleteUser(userCode: string) {
  return ucenterRequest('/core/user/ipmi/delete', {
    method: 'POST',
    data: {userCode}
  })
}

/** 更新用户角色 */
export async function updateUserRole(userCode: string, roles: string[]) {
  return ucenterRequest('/core/user/ipmi/updateRole', {
    method: 'POST',
    data: {userCode, roles},
  })
}
