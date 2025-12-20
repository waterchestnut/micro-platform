// @ts-ignore
/* eslint-disable */
import { ResponseStructure, resourceRequest as request } from '@/services/request';

/** 资源聚合统计 从索引库对资源聚合统计 POST /core/search/resource/agg */
export async function postCoreSearchResourceAgg(options?: { [key: string]: any }) {
  return request<any>('/core/search/resource/agg', {
    method: 'POST',
    ...(options || {}),
  });
}

/** 资源检索 从ES索引库检索资源 POST /core/search/resource/all */
export async function postCoreSearchResourceAll(options?: { [key: string]: any }) {
  return request<any>('/core/search/resource/all', {
    method: 'POST',
    ...(options || {}),
  });
}

/** 资源检索 从多种源检索资源 POST /core/search/resource/merge */
export async function postCoreSearchResourceMerge(options?: { [key: string]: any }) {
  return request<any>('/core/search/resource/merge', {
    method: 'POST',
    ...(options || {}),
  });
}
