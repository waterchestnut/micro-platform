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

/** 当前登录用户修改本人的信息
 * @param {Object} params - 用户信息参数
 * @param {string} params.realName - 真实姓名
 * @param {string} params.nickName - 昵称
 * @param {string} params.avatarUrl - 头像URL
 * @param {string} params.nation - 民族
 * @param {string} params.politics - 政治面貌
 * @param {string} params.birthday - 生日，格式：YYYY-MM-DD
 * @param {number} params.gender - 性别：0-未定义, 1-男性, 2-女性
 * @param {number} params.degree - 学历：0-未设置, 1-专科, 2-本科, 3-硕士, 4-博士
 */
export async function updateCurrentUser(params: any) {
  console.log(params)
  return ucenterRequest('/core/user/cur/profile',{
    method: 'POST',
    data: params
  })
}

/** 更新登录手机 */
export async function updateLoginMobile(mobile: string, smsCode: string) {
  return ucenterRequest('/core/user/cur/mobile',{
    method: 'POST',
    data: {
      mobile,
      smsCode,
    }
  })
}

/** 更新登录邮箱 */
export async function updateLoginEmail(email: string, emailCode: string) {
  return ucenterRequest('/core/user/cur/email',{
    method: 'POST',
    data: {
      email,
      emailCode,
    }
  })
}
