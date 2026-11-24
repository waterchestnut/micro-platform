// @ts-ignore
/* eslint-disable */

import {appRequest, ResponseStructure} from '@/services/request'

/** 获取PC端桌面小组件 */
export async function getPCWidgets(): Promise<APPAPI.Widget[]> {
  let ret = await appRequest('/core/home/widget/list', {
    method: 'GET',
    skipErrorHandler: true,
    params: {homeEndpoint: 'pc'}
  })
  return ret?.data || []
}
