// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 通用获取邮箱验证码 通用获取邮箱验证码 返回值: Default Response POST /core/user/auth/email-code */
export async function postCoreUserAuthEmailCode(
  body: {
    email: string;
    captchaKey: string;
    captcha: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/auth/email-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 邮箱快捷登录 邮箱，验证码方式登录 返回值: Default Response POST /core/user/auth/email/login */
export async function postCoreUserAuthEmailLogin(
  body: {
    email: string;
    verification: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfoWithToken;
  }>('/core/user/auth/email/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取登录验证码 邮箱获取登录验证码 返回值: Default Response POST /core/user/auth/email/verify */
export async function postCoreUserAuthEmailVerify(
  body: {
    email: string;
    captchaKey: string;
    captcha: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/auth/email/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 用户登录 用户名、密码方式登录 返回值: Default Response POST /core/user/auth/login */
export async function postCoreUserAuthLogin(
  body: {
    username: string;
    pwd: string;
    captchaKey: string;
    captcha: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfoWithToken;
  }>('/core/user/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 手机快捷登录 手机号，验证码方式登录 返回值: Default Response POST /core/user/auth/phone/login */
export async function postCoreUserAuthPhoneLogin(
  body: {
    phone: string;
    verification: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfoWithToken;
  }>('/core/user/auth/phone/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取登录验证码 手机号获取登录验证码 返回值: Default Response POST /core/user/auth/phone/verify */
export async function postCoreUserAuthPhoneVerify(
  body: {
    phone: string;
    captchaKey: string;
    captcha: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/auth/phone/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 邮箱注册 用户邮箱注册 返回值: Default Response POST /core/user/auth/register/email */
export async function postCoreUserAuthRegisterEmail(
  body: {
    /** 邮箱 */
    email: string;
    /** 邮箱验证码 */
    emailCode: string;
    /** 密码 */
    pwd: string;
    /** 密码是否加密 */
    encrypt?: boolean;
    /** 真实姓名 */
    realName?: string;
    /** 手机号（可选） */
    mobile?: string;
    /** 是否自动登录 */
    autoLogin?: boolean;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfoWithToken;
  }>('/core/user/auth/register/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 注册获取邮箱验证码 注册时获取邮箱验证码 返回值: Default Response POST /core/user/auth/register/email/verify */
export async function postCoreUserAuthRegisterEmailVerify(
  body: {
    email: string;
    captchaKey: string;
    captcha: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/auth/register/email/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 手机号注册 用户手机号注册 返回值: Default Response POST /core/user/auth/register/phone */
export async function postCoreUserAuthRegisterPhone(
  body: {
    /** 手机号 */
    mobile: string;
    /** 短信验证码 */
    smsCode: string;
    /** 密码 */
    pwd: string;
    /** 密码是否加密 */
    encrypt?: boolean;
    /** 真实姓名 */
    realName?: string;
    /** 邮箱（可选） */
    email?: string;
    /** 是否自动登录 */
    autoLogin?: boolean;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfoWithToken;
  }>('/core/user/auth/register/phone', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 注册获取手机验证码 注册时获取手机验证码 返回值: Default Response POST /core/user/auth/register/phone/verify */
export async function postCoreUserAuthRegisterPhoneVerify(
  body: {
    phone: string;
    captchaKey: string;
    captcha: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/auth/register/phone/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 邮箱验证码重置密码 根据邮箱验证码重置密码 返回值: Default Response POST /core/user/auth/reset-pwd/email */
export async function postCoreUserAuthResetPwdEmail(
  body: {
    /** 邮箱 */
    email: string;
    /** 邮箱验证码 */
    emailCode: string;
    /** 新密码 */
    pwd: string;
    /** 密码是否加密 */
    encrypt?: boolean;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/auth/reset-pwd/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 手机验证码重置密码 根据手机短信验证码重置密码 返回值: Default Response POST /core/user/auth/reset-pwd/phone */
export async function postCoreUserAuthResetPwdPhone(
  body: {
    /** 手机号 */
    mobile: string;
    /** 短信验证码 */
    smsCode: string;
    /** 新密码 */
    pwd: string;
    /** 密码是否加密 */
    encrypt?: boolean;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/auth/reset-pwd/phone', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取加密的公钥 获取密码加密的公钥 返回值: Default Response GET /core/user/auth/rsa-public-key */
export async function getCoreUserAuthRsaPublicKey(options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: string;
  }>('/core/user/auth/rsa-public-key', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 通用获取手机验证码 通用获取手机验证码 返回值: Default Response POST /core/user/auth/sms-code */
export async function postCoreUserAuthSmsCode(
  body: {
    phone: string;
    captchaKey: string;
    captcha: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/user/auth/sms-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 刷新token 根据Refresh Token重新获取一套accessToken和refreshToken 返回值: Default Response POST /core/user/auth/token/refresh */
export async function postCoreUserAuthTokenRefresh(
  body: {
    refreshToken: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.UserInfoWithToken;
  }>('/core/user/auth/token/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
