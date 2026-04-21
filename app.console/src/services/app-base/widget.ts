// @ts-ignore
/* eslint-disable */
import { ResponseStructure, appRequest as request } from '@/services/request';

/** 添加单个小组件 添加单个小组件 返回值: Default Response POST /core/widget/add */
export async function postCoreWidgetAdd(body: APPAPI.Widget, options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Widget;
  }>('/core/widget/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
