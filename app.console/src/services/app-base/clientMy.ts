// @ts-ignore
/* eslint-disable */
import { ResponseStructure, appRequest as request } from '@/services/request';

/** 删除应用 删除应用 返回值: Default Response POST /core/client-my/delete */
export async function postCoreClientMyOpenApiDelete(
  body: {
    clientCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/client-my/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取应用的详细信息 获取应用全部信息结构 返回值: Default Response GET /core/client-my/detail */
export async function getCoreClientMyDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientMyDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Client;
  }>('/core/client-my/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用应用 禁用应用 返回值: Default Response POST /core/client-my/disable */
export async function postCoreClientMyDisable(
  body: {
    clientCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/client-my/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用应用 启用应用 返回值: Default Response POST /core/client-my/enable */
export async function postCoreClientMyEnable(
  body: {
    clientCode: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/client-my/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 应用列表 获取我创建的应用列表 返回值: Default Response POST /core/client-my/list */
export async function postCoreClientMyList(
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
    data?: { total?: number; rows?: APPAPI.Client[] };
  }>('/core/client-my/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加应用模块 添加应用模块 返回值: Default Response POST /core/client-my/module/add */
export async function postCoreClientMyModuleAdd(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientMyModuleAddParams,
  body: {
    moduleCode: string;
    moduleName: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { moduleCode?: string; moduleName?: string };
  }>('/core/client-my/module/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除应用模块 删除应用模块 返回值: Default Response POST /core/client-my/module/delete */
export async function postCoreClientMyModuleOpenApiDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientMyModule_openAPI_deleteParams,
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
  }>('/core/client-my/module/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
    },
    data: body,
    ...(options || {}),
  });
}

/** 模块列表 获取应用的模块列表 返回值: Default Response GET /core/client-my/module/list */
export async function getCoreClientMyModuleList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientMyModuleListParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { moduleCode: string; moduleName: string }[];
  }>('/core/client-my/module/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 路由权限列表 获取应用的路由权限列表 返回值: Default Response GET /core/client-my/page/list */
export async function getCoreClientMyPageList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientMyPageListParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: {
      name: string;
      path: string;
      auth?: boolean;
      clientAuth?: boolean;
      privs?: string[];
      clientPrivs?: string[];
    }[];
  }>('/core/client-my/page/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 保存应用的路由权限 保存应用的路由权限 返回值: Default Response POST /core/client-my/page/save */
export async function postCoreClientMyPageSave(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientMyPageSaveParams,
  body: {
    /** 配置列表 */
    pageConfigs: {
      name: string;
      path: string;
      auth?: boolean;
      clientAuth?: boolean;
      privs?: string[];
      clientPrivs?: string[];
    }[];
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: number;
  }>('/core/client-my/page/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
    },
    data: body,
    ...(options || {}),
  });
}

/** 添加应用模块权限 添加应用模块权限 返回值: Default Response POST /core/client-my/priv/add */
export async function postCoreClientMyPrivAdd(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientMyPrivAddParams,
  body: {
    modulePrivCode: string;
    modulePrivName: string;
    moduleCode: string;
    moduleName?: string;
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: {
      modulePrivCode?: string;
      modulePrivName?: string;
      moduleCode?: string;
      moduleName?: string;
    };
  }>('/core/client-my/priv/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
    },
    data: body,
    ...(options || {}),
  });
}

/** 删除应用模块权限 删除应用模块权限 返回值: Default Response POST /core/client-my/priv/delete */
export async function postCoreClientMyPrivOpenApiDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientMyPriv_openAPI_deleteParams,
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
  }>('/core/client-my/priv/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
    },
    data: body,
    ...(options || {}),
  });
}

/** 角色权限列表 获取应用的角色权限列表 返回值: Default Response GET /core/client-my/priv/group/list */
export async function getCoreClientMyPrivGroupList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientMyPrivGroupListParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { groupCode?: string; groupName?: string; modulePrivCodes?: string[] }[];
  }>('/core/client-my/priv/group/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 保存用户组权限 保存用户组权限 返回值: Default Response POST /core/client-my/priv/group/save-priv */
export async function postCoreClientMyPrivGroupSavePriv(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientMyPrivGroupSavePrivParams,
  body: {
    groupCode: string;
    modulePrivCodes?: string[];
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: number;
  }>('/core/client-my/priv/group/save-priv', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
    },
    data: body,
    ...(options || {}),
  });
}

/** 模块权限列表 获取应用的模块权限列表 返回值: Default Response GET /core/client-my/priv/list */
export async function getCoreClientMyPrivList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientMyPrivListParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: {
      modulePrivCode: string;
      modulePrivName: string;
      moduleCode: string;
      moduleName?: string;
    }[];
  }>('/core/client-my/priv/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 获取应用授权给其他应用的权限列表 获取应用授权给其他应用的权限列表 返回值: Default Response POST /core/client-my/priv/other-client/list */
export async function postCoreClientMyPrivOtherClientList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientMyPrivOtherClientListParams,
  body: {
    toClientCodes: string[];
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { clientCode?: string; clientName?: string; modulePrivCodes?: string[] }[];
  }>('/core/client-my/priv/other-client/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
    },
    data: body,
    ...(options || {}),
  });
}

/** 保存给其他应用分配的权限 保存给其他应用分配的权限 返回值: Default Response POST /core/client-my/priv/other-client/save-priv */
export async function postCoreClientMyPrivOtherClientSavePriv(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientMyPrivOtherClientSavePrivParams,
  body: {
    toClientCode: string;
    modulePrivCodes?: string[];
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: number;
  }>('/core/client-my/priv/other-client/save-priv', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    params: {
      ...params,
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取应用在授权中心的信息结构 获取应用在授权中心的信息结构 返回值: Default Response GET /core/client-my/ucenter/detail */
export async function getCoreClientMyUcenterDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientMyUcenterDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: {
      clientCode?: string;
      clientName?: string;
      clientSecret?: string;
      retUrls?: string[];
      status?: number;
      modulePrivCodes?: string[];
    };
  }>('/core/client-my/ucenter/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 保存应用在授权中心的信息 保存应用在授权中心的信息 返回值: Default Response POST /core/client-my/ucenter/save */
export async function postCoreClientMyUcenterSave(
  body: {
    clientCode: string;
    clientName?: string;
    clientSecret?: string;
    retUrls?: string[];
  },
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/client-my/ucenter/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个应用 修改单个应用 返回值: Default Response POST /core/client-my/update */
export async function postCoreClientMyUpdate(
  body: APPAPI.Client,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/client-my/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
