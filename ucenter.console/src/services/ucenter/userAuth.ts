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

/** 手机号注册 */
export async function phoneRegister(mobile: string, smsCode: string, pwd: string, realName?: string) {
  const publicKey = (await getPublicKey()).data
  const publicK = forge.pki.publicKeyFromPem(publicKey)
  const encrypted = btoa(publicK.encrypt(encodeURIComponent(pwd), 'RSA-OAEP'))
  return ucenterRequest('/core/user/auth/register/phone', {
    method: 'POST',
    data: {mobile, smsCode, pwd: encrypted, encrypt: true, realName}
  })
}

/** 获得手机注册验证码 */
export async function phoneRegisterVerify(phone: string, captchaKey: string, captcha: string) {
  return ucenterRequest('/core/user/auth/register/phone/verify', {
    method: 'POST',
    data: {phone, captchaKey, captcha}
  })
}

/** 邮箱注册 */
export async function emailRegister(email: string, emailCode: string, pwd: string, realName?: string) {
  const publicKey = (await getPublicKey()).data
  const publicK = forge.pki.publicKeyFromPem(publicKey)
  const encrypted = btoa(publicK.encrypt(encodeURIComponent(pwd), 'RSA-OAEP'))
  return ucenterRequest('/core/user/auth/register/email', {
    method: 'POST',
    data: {email, emailCode, pwd: encrypted, encrypt: true, realName}
  })
}

/** 获得邮箱注册验证码 */
export async function emailRegisterVerify(email: string, captchaKey: string, captcha: string) {
  return ucenterRequest('/core/user/auth/register/email/verify', {
    method: 'POST',
    data: {email, captchaKey, captcha}
  })
}

/** 通用获取手机验证码 */
export async function getSmsCode(phone: string, captchaKey: string, captcha: string) {
  return ucenterRequest('/core/user/auth/sms-code',{
    method: 'POST',
    data: {
      phone,
      captchaKey,
      captcha: `${captcha}`
    }
  })
}

/** 通用获取邮箱验证码 */
export async function getEmailCode(email: string, captchaKey: string, captcha: string) {
  //console.log('getEmailCode', email, captchaKey, captcha)
  return ucenterRequest('/core/user/auth/email-code',{
    method: 'POST',
    data: {
      email,
      captchaKey,
      captcha: `${captcha}`
    }
  })
}

/** 根据手机验证码修改密码 */
export async function resetPwdByMobile(mobile: string, smsCode: string, newPassword: string) {
  let publicKey = (await getPublicKey()).data
  const publicK = forge.pki.publicKeyFromPem(publicKey)
  const encrypted = btoa(publicK.encrypt(encodeURIComponent(newPassword), 'RSA-OAEP'))
  return ucenterRequest('/core/user/auth/reset-pwd/phone',{
    method: 'POST',
    data: {
      mobile,
      smsCode,
      pwd: encrypted,
      encrypt: 1
    }
  })
}

/** 根据邮箱验证码修改密码 */
export async function resetPwdByEmail(email: string, emailCode: string, newPassword: string) {
  let publicKey = (await getPublicKey()).data
  const publicK = forge.pki.publicKeyFromPem(publicKey)
  const encrypted = btoa(publicK.encrypt(encodeURIComponent(newPassword), 'RSA-OAEP'))
  return ucenterRequest('/core/user/auth/reset-pwd/email',{
    method: 'POST',
    data: {
      email,
      emailCode,
      pwd: encrypted,
      encrypt: 1
    }
  })
}
