// @ts-ignore
/* eslint-disable */
import { ResponseStructure, resourceRequest as request } from '@/services/request';

/** 推荐资源 推荐资源 POST /public-bin/resource/recommend */
export async function postPublicBinResourceRecommend(options?: { [key: string]: any }) {
  return request<any>('/public-bin/resource/recommend', {
    method: 'POST',
    ...(options || {}),
  });
}

/** 论文详情 获取论文详情 GET /public-bin/resource/thesis/detail */
export async function getPublicBinResourceThesisDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RESOURCEAPI.getPublicBinResourceThesisDetailParams,
  options?: { [key: string]: any },
) {
  return request<any>('/public-bin/resource/thesis/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}
