// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ragRequest as request } from '@/services/request';

/** 添加单个材料分句 添加单个材料分句 返回值: Default Response POST /core/rag-info/ipmi-chunk/add */
export async function postCoreRagInfoIpmiChunkAdd(
  body: RAGAPI.RagChunk,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagChunk;
  }>('/core/rag-info/ipmi-chunk/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除材料分句 删除材料分句 返回值: Default Response POST /core/rag-info/ipmi-chunk/delete */
export async function postCoreRagInfoIpmiChunkOpenApiDelete(
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
  }>('/core/rag-info/ipmi-chunk/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取材料分句的详细信息 获取材料分句全部信息结构 返回值: Default Response GET /core/rag-info/ipmi-chunk/detail */
export async function getCoreRagInfoIpmiChunkDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RAGAPI.getCoreRagInfoIpmiChunkDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagChunk;
  }>('/core/rag-info/ipmi-chunk/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用材料分句 禁用材料分句 返回值: Default Response POST /core/rag-info/ipmi-chunk/disable */
export async function postCoreRagInfoIpmiChunkDisable(
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
  }>('/core/rag-info/ipmi-chunk/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用材料分句 启用材料分句 返回值: Default Response POST /core/rag-info/ipmi-chunk/enable */
export async function postCoreRagInfoIpmiChunkEnable(
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
  }>('/core/rag-info/ipmi-chunk/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 材料分句列表 获取材料分句列表 返回值: Default Response POST /core/rag-info/ipmi-chunk/list */
export async function postCoreRagInfoIpmiChunkList(
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
  }>('/core/rag-info/ipmi-chunk/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个材料分句 修改单个材料分句 返回值: Default Response POST /core/rag-info/ipmi-chunk/update */
export async function postCoreRagInfoIpmiChunkUpdate(
  body: RAGAPI.RagChunk,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-info/ipmi-chunk/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加单个材料 添加单个材料 返回值: Default Response POST /core/rag-info/ipmi-material/add */
export async function postCoreRagInfoIpmiMaterialAdd(
  body: RAGAPI.RagMaterial,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagMaterial;
  }>('/core/rag-info/ipmi-material/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除知识库材料 删除知识库材料 返回值: Default Response POST /core/rag-info/ipmi-material/delete */
export async function postCoreRagInfoIpmiMaterialOpenApiDelete(
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
  }>('/core/rag-info/ipmi-material/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取知识库材料的详细信息 获取知识库材料全部信息结构 返回值: Default Response GET /core/rag-info/ipmi-material/detail */
export async function getCoreRagInfoIpmiMaterialDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RAGAPI.getCoreRagInfoIpmiMaterialDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagMaterial;
  }>('/core/rag-info/ipmi-material/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用知识库材料 禁用知识库材料 返回值: Default Response POST /core/rag-info/ipmi-material/disable */
export async function postCoreRagInfoIpmiMaterialDisable(
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
  }>('/core/rag-info/ipmi-material/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用知识库材料 启用知识库材料 返回值: Default Response POST /core/rag-info/ipmi-material/enable */
export async function postCoreRagInfoIpmiMaterialEnable(
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
  }>('/core/rag-info/ipmi-material/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 知识库材料列表 获取知识库材料列表 返回值: Default Response POST /core/rag-info/ipmi-material/list */
export async function postCoreRagInfoIpmiMaterialList(
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
  }>('/core/rag-info/ipmi-material/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个知识库材料 修改单个知识库材料 返回值: Default Response POST /core/rag-info/ipmi-material/update */
export async function postCoreRagInfoIpmiMaterialUpdate(
  body: RAGAPI.RagMaterial,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-info/ipmi-material/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加单个材料分段 添加单个材料分段 返回值: Default Response POST /core/rag-info/ipmi-segment/add */
export async function postCoreRagInfoIpmiSegmentAdd(
  body: RAGAPI.RagSegment,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagSegment;
  }>('/core/rag-info/ipmi-segment/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除材料分段 删除材料分段 返回值: Default Response POST /core/rag-info/ipmi-segment/delete */
export async function postCoreRagInfoIpmiSegmentOpenApiDelete(
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
  }>('/core/rag-info/ipmi-segment/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取材料分段的详细信息 获取材料分段全部信息结构 返回值: Default Response GET /core/rag-info/ipmi-segment/detail */
export async function getCoreRagInfoIpmiSegmentDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RAGAPI.getCoreRagInfoIpmiSegmentDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagSegment;
  }>('/core/rag-info/ipmi-segment/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用材料分段 禁用材料分段 返回值: Default Response POST /core/rag-info/ipmi-segment/disable */
export async function postCoreRagInfoIpmiSegmentDisable(
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
  }>('/core/rag-info/ipmi-segment/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用材料分段 启用材料分段 返回值: Default Response POST /core/rag-info/ipmi-segment/enable */
export async function postCoreRagInfoIpmiSegmentEnable(
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
  }>('/core/rag-info/ipmi-segment/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 材料分段列表 获取材料分段列表 返回值: Default Response POST /core/rag-info/ipmi-segment/list */
export async function postCoreRagInfoIpmiSegmentList(
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
  }>('/core/rag-info/ipmi-segment/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个材料分段 修改单个材料分段 返回值: Default Response POST /core/rag-info/ipmi-segment/update */
export async function postCoreRagInfoIpmiSegmentUpdate(
  body: RAGAPI.RagSegment,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-info/ipmi-segment/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除知识库 删除知识库 返回值: Default Response POST /core/rag-info/ipmi/delete */
export async function postCoreRagInfoIpmiOpenApiDelete(
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
  }>('/core/rag-info/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取知识库的详细信息 获取知识库全部信息结构 返回值: Default Response GET /core/rag-info/ipmi/detail */
export async function getCoreRagInfoIpmiDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: RAGAPI.getCoreRagInfoIpmiDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: RAGAPI.RagInfo;
  }>('/core/rag-info/ipmi/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用知识库 禁用知识库 返回值: Default Response POST /core/rag-info/ipmi/disable */
export async function postCoreRagInfoIpmiDisable(
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
  }>('/core/rag-info/ipmi/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用知识库 启用知识库 返回值: Default Response POST /core/rag-info/ipmi/enable */
export async function postCoreRagInfoIpmiEnable(
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
  }>('/core/rag-info/ipmi/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 知识库列表 获取知识库列表 返回值: Default Response POST /core/rag-info/ipmi/list */
export async function postCoreRagInfoIpmiList(
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
  }>('/core/rag-info/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个知识库 修改单个知识库 返回值: Default Response POST /core/rag-info/ipmi/update */
export async function postCoreRagInfoIpmiUpdate(
  body: RAGAPI.RagInfo,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/rag-info/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
