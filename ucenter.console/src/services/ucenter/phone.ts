// @ts-ignore
/* eslint-disable */

import {ResponseStructure, ucenterRequest} from "@/services/request";

/** 查询手机号归属地 */
export async function queryPhoneRegion(phone : string, options: API.ListOptions = {}) {
    let ret = await ucenterRequest('/public-bin/mobile-range/check', {
      method: 'GET',
      params: {phone}
    });
    console.log((ret))
    let defaultRet = {provName: '未查询到该手机号', cityName: '未查询到该手机号'};
    if (ret.code === 0) {
      if(ret.data == null)return defaultRet; 
      return ret.data;
    } else {
      return defaultRet;
    }
  }