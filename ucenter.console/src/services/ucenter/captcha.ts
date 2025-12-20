// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 刷新验证码图片 */
export async function getCaptcha(captchaKey: string) {
  return ucenterRequest('/core/captcha', {method: 'GET', params: {captchaKey}})
}
