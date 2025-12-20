// @ts-ignore
/* eslint-disable */
import { ResponseStructure, ucenterRequest as request } from '@/services/request';

/** 接口权限验证 接口权限验证 返回值: Default Response POST /auth/check */
export async function postAuthCheck(
  body: {
    path: string;
    method: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { userInfo?: string; clientInfo?: string };
  }>('/auth/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加单个模块 添加单个模块 返回值: Default Response POST /auth/module/add */
export async function postAuthModuleAdd(body: UCENTERAPI.Module, options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.Module;
  }>('/auth/module/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除模块 删除模块 返回值: Default Response POST /auth/module/delete */
export async function postAuthModuleOpenApiDelete(
  body: {
    moduleCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/auth/module/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 模块列表 获取模块列表 返回值: Default Response POST /auth/module/list */
export async function postAuthModuleList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any>; withFormat?: number };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { total?: number; rows?: UCENTERAPI.ModuleFormatted[] };
  }>('/auth/module/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个模块 修改单个模块 返回值: Default Response POST /auth/module/update */
export async function postAuthModuleUpdate(
  body: UCENTERAPI.Module,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/auth/module/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取所有的路由配置 获取所有的路由配置 返回值: Default Response GET /auth/page/all */
export async function getAuthPageAll(options?: { [key: string]: any }) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.PageConfigFormatted[];
  }>('/auth/page/all', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 更新所有的路由配置 更新所有的路由配置 返回值: Default Response POST /auth/page/all/save */
export async function postAuthPageAllSave(
  body: {
    /** 配置列表 */
    infos: UCENTERAPI.PageConfig[];
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.PageConfigFormatted[];
  }>('/auth/page/all/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除路由配置 删除路由配置 返回值: Default Response POST /auth/page/delete */
export async function postAuthPageOpenApiDelete(
  body: {
    pageConfigCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/auth/page/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 路由配置列表 获取路由配置列表 返回值: Default Response POST /auth/page/list */
export async function postAuthPageList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any>; withFormat?: number };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { total?: number; rows?: UCENTERAPI.PageConfigFormatted[] };
  }>('/auth/page/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加或更新单个路由配置 添加或更新单个路由配置 返回值: Default Response POST /auth/page/save */
export async function postAuthPageSave(
  body: UCENTERAPI.PageConfig,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.PageConfig;
  }>('/auth/page/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加单个权限 添加单个权限 返回值: Default Response POST /auth/priv/add */
export async function postAuthPrivAdd(
  body: UCENTERAPI.ModulePriv,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: UCENTERAPI.ModulePriv;
  }>('/auth/priv/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除权限 删除权限 返回值: Default Response POST /auth/priv/delete */
export async function postAuthPrivOpenApiDelete(
  body: {
    modulePrivCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/auth/priv/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 权限列表 获取权限列表 返回值: Default Response POST /auth/priv/list */
export async function postAuthPrivList(
  body: {
    filter?: Record<string, any>;
    pageIndex?: number;
    pageSize?: number;
    options?: { total?: number; sort?: Record<string, any>; withFormat?: number };
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { total?: number; rows?: UCENTERAPI.ModulePrivFormatted[] };
  }>('/auth/priv/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个权限 修改单个权限 返回值: Default Response POST /auth/priv/update */
export async function postAuthPrivUpdate(
  body: UCENTERAPI.ModulePriv,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/auth/priv/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
