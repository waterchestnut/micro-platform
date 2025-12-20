// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from '@/services/request'
import forge from 'node-forge'

/** 获取登录用的rsa公钥 */
export async function getPublicKey() {
  return ucenterRequest('/core/user/auth/rsa-public-key', {method: 'GET'})
}

/** 用户名+密码登录 */
export async function login(username: string, pwd: string, captchaKey: string, captcha: string) {
  let publicKey = (await getPublicKey()).data
  const publicK = forge.pki.publicKeyFromPem(publicKey)
  const encrypted = btoa(publicK.encrypt(encodeURIComponent(pwd), 'RSA-OAEP'))
  return ucenterRequest('/core/user/auth/login', {
    method: 'POST',
    data: {username, pwd: encrypted, captchaKey, captcha}
  })
}

/** 手机号验证码登录 */
export async function phoneLogin(phone: string, verification: string) {
  return ucenterRequest('/core/user/auth/phone/login', {
    method: 'POST',
    data: {phone, verification}
  })
}

/** 获得手机验证码 */
export async function phoneLoginVerify(phone: string, captchaKey: string, captcha: string) {
  return ucenterRequest('/core/user/auth/phone/verify', {
    method: 'POST',
    data: {phone, captchaKey, captcha}
  })
}

/** 邮箱验证码登录 */
export async function emailLogin(email: string, verification: string) {
  return ucenterRequest('/core/user/auth/email/login', {
    method: 'POST',
    data: {email, verification}
  })
}

/** 获得邮箱验证码 */
export async function emailLoginVerify(email: string, captchaKey: string, captcha: string) {
  return ucenterRequest('/core/user/auth/email/verify', {
    method: 'POST',
    data: {email, captchaKey, captcha}
  })
}
