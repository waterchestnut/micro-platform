// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ragRequest as request } from '@/services/request';

/** 添加单个材料分句 添加单个材料分句 返回值: Default Response POST /core/rag-my/chunk/add */
export async function postCoreRagMyChunkAdd(
  body: RAGAPI.RagChunk,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagChunk;
  }>('/core/rag-my/chunk/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除材料分句 删除材料分句 返回值: Default Response POST /core/rag-my/chunk/delete */
export async function postCoreRagMyChunkOpenApiDelete(
  body: {
    ragChunkCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/chunk/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取材料分句的详细信息 获取材料分句全部信息结构 返回值: Default Response GET /core/rag-my/chunk/detail */
export async function getCoreRagMyChunkDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RAGAPI.getCoreRagMyChunkDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagChunk;
  }>('/core/rag-my/chunk/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用材料分句 禁用材料分句 返回值: Default Response POST /core/rag-my/chunk/disable */
export async function postCoreRagMyChunkDisable(
  body: {
    ragChunkCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/chunk/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用材料分句 启用材料分句 返回值: Default Response POST /core/rag-my/chunk/enable */
export async function postCoreRagMyChunkEnable(
  body: {
    ragChunkCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/chunk/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 材料分句列表 获取材料分句列表 返回值: Default Response POST /core/rag-my/chunk/list */
export async function postCoreRagMyChunkList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any> };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { total?: number; rows?: RAGAPI.RagChunk[] };
  }>('/core/rag-my/chunk/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个材料分句 修改单个材料分句 返回值: Default Response POST /core/rag-my/chunk/update */
export async function postCoreRagMyChunkUpdate(
  body: RAGAPI.RagChunk,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/chunk/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除知识库 删除知识库 返回值: Default Response POST /core/rag-my/delete */
export async function postCoreRagMyOpenApiDelete(
  body: {
    ragCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取知识库的详细信息 获取知识库全部信息结构 返回值: Default Response GET /core/rag-my/detail */
export async function getCoreRagMyDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RAGAPI.getCoreRagMyDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagInfo;
  }>('/core/rag-my/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用知识库 禁用知识库 返回值: Default Response POST /core/rag-my/disable */
export async function postCoreRagMyDisable(
  body: {
    ragCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用知识库 启用知识库 返回值: Default Response POST /core/rag-my/enable */
export async function postCoreRagMyEnable(
  body: {
    ragCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 知识库列表 获取我创建的知识库列表 返回值: Default Response POST /core/rag-my/list */
export async function postCoreRagMyList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any> };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { total?: number; rows?: RAGAPI.RagInfo[] };
  }>('/core/rag-my/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加单个材料 添加单个材料 返回值: Default Response POST /core/rag-my/material/add */
export async function postCoreRagMyMaterialAdd(
  body: RAGAPI.RagMaterial,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagMaterial;
  }>('/core/rag-my/material/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除知识库材料 删除知识库材料 返回值: Default Response POST /core/rag-my/material/delete */
export async function postCoreRagMyMaterialOpenApiDelete(
  body: {
    ragMaterialCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/material/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取知识库材料的详细信息 获取知识库材料全部信息结构 返回值: Default Response GET /core/rag-my/material/detail */
export async function getCoreRagMyMaterialDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RAGAPI.getCoreRagMyMaterialDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagMaterial;
  }>('/core/rag-my/material/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用知识库材料 禁用知识库材料 返回值: Default Response POST /core/rag-my/material/disable */
export async function postCoreRagMyMaterialDisable(
  body: {
    ragMaterialCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/material/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用知识库材料 启用知识库材料 返回值: Default Response POST /core/rag-my/material/enable */
export async function postCoreRagMyMaterialEnable(
  body: {
    ragMaterialCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/material/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 知识库材料列表 获取知识库材料列表 返回值: Default Response POST /core/rag-my/material/list */
export async function postCoreRagMyMaterialList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any> };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { total?: number; rows?: RAGAPI.RagMaterial[] };
  }>('/core/rag-my/material/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个知识库材料 修改单个知识库材料 返回值: Default Response POST /core/rag-my/material/update */
export async function postCoreRagMyMaterialUpdate(
  body: RAGAPI.RagMaterial,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/material/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加单个材料分段 添加单个材料分段 返回值: Default Response POST /core/rag-my/segment/add */
export async function postCoreRagMySegmentAdd(
  body: RAGAPI.RagSegment,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagSegment;
  }>('/core/rag-my/segment/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除材料分段 删除材料分段 返回值: Default Response POST /core/rag-my/segment/delete */
export async function postCoreRagMySegmentOpenApiDelete(
  body: {
    ragSegmentCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/segment/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取材料分段的详细信息 获取材料分段全部信息结构 返回值: Default Response GET /core/rag-my/segment/detail */
export async function getCoreRagMySegmentDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RAGAPI.getCoreRagMySegmentDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagSegment;
  }>('/core/rag-my/segment/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用材料分段 禁用材料分段 返回值: Default Response POST /core/rag-my/segment/disable */
export async function postCoreRagMySegmentDisable(
  body: {
    ragSegmentCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/segment/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用材料分段 启用材料分段 返回值: Default Response POST /core/rag-my/segment/enable */
export async function postCoreRagMySegmentEnable(
  body: {
    ragSegmentCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/segment/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 材料分段列表 获取材料分段列表 返回值: Default Response POST /core/rag-my/segment/list */
export async function postCoreRagMySegmentList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any> };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { total?: number; rows?: RAGAPI.RagSegment[] };
  }>('/core/rag-my/segment/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个材料分段 修改单个材料分段 返回值: Default Response POST /core/rag-my/segment/update */
export async function postCoreRagMySegmentUpdate(
  body: RAGAPI.RagSegment,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/segment/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个知识库 修改单个知识库 返回值: Default Response POST /core/rag-my/update */
export async function postCoreRagMyUpdate(body: RAGAPI.RagInfo, options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-my/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
