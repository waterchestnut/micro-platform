// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";
import {setUserCache} from "@/utils/authority";
import {getEmbeddedProps, isEmbedded} from "@/utils/embed";

/** 获取当前登录用户信息 */
export async function queryCurrentUser() {
  if (isEmbedded()) {
    return {
      code: 0,
      data: getEmbeddedProps()?.getUserCache()
    }
  }

  let ret = await ucenterRequest('/core/user/cur', {method: 'GET', skipErrorHandler: true});
  if (process.env.NODE_ENV === 'development') {
    setUserCache(ret?.data);
  }
  return ret;
}
