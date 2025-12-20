// @ts-ignore
/* eslint-disable */
import { ResponseStructure, statisticRequest as request } from '@/services/request';

/** 日志聚合统计 从索引库对日志聚合统计 POST /core/search/msg/agg */
export async function postCoreSearchMsgAgg(options?: { [key: string]: any }) {
  return request<any>('/core/search/msg/agg', {
    method: 'POST',
    ...(options || {}),
  });
}

/** 日志检索 从ES索引库检索日志 POST /core/search/msg/all */
export async function postCoreSearchMsgAll(options?: { [key: string]: any }) {
  return request<any>('/core/search/msg/all', {
    method: 'POST',
    ...(options || {}),
  });
}
