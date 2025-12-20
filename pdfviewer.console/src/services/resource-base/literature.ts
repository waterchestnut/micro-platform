// @ts-ignore
/* eslint-disable */
import { ResponseStructure, resourceRequest as request } from '@/services/request';

/** 核查资源文献阅读的准备状态 核查资源文献阅读的准备情况，资源是否复制到当前用户名下，资源的RAG是否完成等。 POST /core/literature/check */
export async function postCoreLiteratureCheck(
  body: {
    /** 资源标识 */
    resCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/core/literature/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 本地文件解读 本地文件上传后进行文献解读 POST /core/literature/local-file */
export async function postCoreLiteratureLocalFile(
  body: RESOURCEAPI.FileInfo,
  options?: { [key: string]: any },
) {
  return request<any>('/core/literature/local-file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除文献解读历史记录 删除文献解读历史记录 POST /core/literature/remove */
export async function postCoreLiteratureRemove(
  body: {
    /** 资源标识 */
    resCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/core/literature/remove', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
