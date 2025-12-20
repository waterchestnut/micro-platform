// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";
import forge from 'node-forge';

/** 用户名+密码登录 */
export async function getPublicKey() {
  return ucenterRequest('/core/user/auth/rsa-public-key', {method: 'GET'});
}
