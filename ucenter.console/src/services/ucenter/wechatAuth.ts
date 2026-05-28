import {ucenterRequest} from '@/services/request'

export async function getWechatAuthUrl() {
  return ucenterRequest('/public-bin/wechat/auth-url', {method: 'GET'})
}

export async function getWechatLoginStatus(state: string) {
  return ucenterRequest('/public-bin/wechat/login-status', {
    method: 'GET',
    params: {state}
  })
}

export async function getWechatConfig() {
  return ucenterRequest('/public-bin/wechat/config', {method: 'GET'})
}

export async function getWechatBindStatus() {
  return ucenterRequest('/core/user/cur/wechat/bind-status', {method: 'GET'})
}

export async function getWechatBindUrl() {
  return ucenterRequest('/core/user/cur/wechat/bind-url', {method: 'POST'})
}

export async function unbindWechat() {
  return ucenterRequest('/core/user/cur/wechat/unbind', {method: 'POST'})
}

export async function miniProgramLogin(code: string) {
  return ucenterRequest('/public-bin/wechat/mp/login', {
    method: 'POST',
    data: {code}
  })
}

export async function registerWechatUser(state: string) {
  return ucenterRequest('/public-bin/wechat/register', {
    method: 'POST',
    data: {state}
  })
}

export async function bindWechatWithLogin(state: string, loginType: string, params: Record<string, any>) {
  return ucenterRequest('/public-bin/wechat/bind-login', {
    method: 'POST',
    data: {state, loginType, ...params}
  })
}

export async function registerMpUser(bindToken: string) {
  return ucenterRequest('/public-bin/wechat/mp/register', {
    method: 'POST',
    data: {bindToken}
  })
}

export async function bindMpWithLogin(bindToken: string, loginType: string, params: Record<string, any>) {
  return ucenterRequest('/public-bin/wechat/mp/bind-login', {
    method: 'POST',
    data: {bindToken, loginType, ...params}
  })
}