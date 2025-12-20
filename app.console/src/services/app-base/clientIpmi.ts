// @ts-ignore
/* eslint-disable */
import { ResponseStructure, appRequest as request } from '@/services/request';

/** 添加应用模块 添加应用模块 返回值: Default Response POST /core/client/ipmi-module/add */
export async function postCoreClientIpmiModuleAdd(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientIpmiModuleAddParams,
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
  }>('/core/client/ipmi-module/add', {
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

/** 删除应用模块 删除应用模块 返回值: Default Response POST /core/client/ipmi-module/delete */
export async function postCoreClientIpmiModuleOpenApiDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientIpmiModule_openAPI_deleteParams,
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
  }>('/core/client/ipmi-module/delete', {
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

/** 模块列表 获取应用的模块列表 返回值: Default Response GET /core/client/ipmi-module/list */
export async function getCoreClientIpmiModuleList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientIpmiModuleListParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { moduleCode: string; moduleName: string }[];
  }>('/core/client/ipmi-module/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 路由权限列表 获取应用的路由权限列表 返回值: Default Response GET /core/client/ipmi-page/list */
export async function getCoreClientIpmiPageList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientIpmiPageListParams,
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
  }>('/core/client/ipmi-page/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 保存应用的路由权限 保存应用的路由权限 返回值: Default Response POST /core/client/ipmi-page/save */
export async function postCoreClientIpmiPageSave(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientIpmiPageSaveParams,
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
  }>('/core/client/ipmi-page/save', {
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

/** 添加应用模块权限 添加应用模块权限 返回值: Default Response POST /core/client/ipmi-priv/add */
export async function postCoreClientIpmiPrivAdd(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientIpmiPrivAddParams,
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
  }>('/core/client/ipmi-priv/add', {
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

/** 删除应用模块权限 删除应用模块权限 返回值: Default Response POST /core/client/ipmi-priv/delete */
export async function postCoreClientIpmiPrivOpenApiDelete(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientIpmiPriv_openAPI_deleteParams,
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
  }>('/core/client/ipmi-priv/delete', {
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

/** 角色权限列表 获取应用的角色权限列表 返回值: Default Response GET /core/client/ipmi-priv/group/list */
export async function getCoreClientIpmiPrivGroupList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientIpmiPrivGroupListParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: { groupCode?: string; groupName?: string; modulePrivCodes?: string[] }[];
  }>('/core/client/ipmi-priv/group/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 保存用户组权限 保存用户组权限 返回值: Default Response POST /core/client/ipmi-priv/group/save-priv */
export async function postCoreClientIpmiPrivGroupSavePriv(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientIpmiPrivGroupSavePrivParams,
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
  }>('/core/client/ipmi-priv/group/save-priv', {
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

/** 模块权限列表 获取应用的模块权限列表 返回值: Default Response GET /core/client/ipmi-priv/list */
export async function getCoreClientIpmiPrivList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientIpmiPrivListParams,
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
  }>('/core/client/ipmi-priv/list', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 获取应用授权给其他应用的权限列表 获取应用授权给其他应用的权限列表 返回值: Default Response POST /core/client/ipmi-priv/other-client/list */
export async function postCoreClientIpmiPrivOtherClientList(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientIpmiPrivOtherClientListParams,
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
  }>('/core/client/ipmi-priv/other-client/list', {
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

/** 保存给其他应用分配的权限 保存给其他应用分配的权限 返回值: Default Response POST /core/client/ipmi-priv/other-client/save-priv */
export async function postCoreClientIpmiPrivOtherClientSavePriv(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.postCoreClientIpmiPrivOtherClientSavePrivParams,
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
  }>('/core/client/ipmi-priv/other-client/save-priv', {
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

/** 删除应用 删除应用 返回值: Default Response POST /core/client/ipmi/delete */
export async function postCoreClientIpmiOpenApiDelete(
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
  }>('/core/client/ipmi/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取应用的详细信息 获取应用全部信息结构 返回值: Default Response GET /core/client/ipmi/detail */
export async function getCoreClientIpmiDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientIpmiDetailParams,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: APPAPI.Client;
  }>('/core/client/ipmi/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 禁用应用 禁用应用 返回值: Default Response POST /core/client/ipmi/disable */
export async function postCoreClientIpmiDisable(
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
  }>('/core/client/ipmi/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 启用应用 启用应用 返回值: Default Response POST /core/client/ipmi/enable */
export async function postCoreClientIpmiEnable(
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
  }>('/core/client/ipmi/enable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 应用列表 获取应用列表 返回值: Default Response POST /core/client/ipmi/list */
export async function postCoreClientIpmiList(
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
  }>('/core/client/ipmi/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 获取应用在授权中心的信息结构 获取应用在授权中心的信息结构 返回值: Default Response GET /core/client/ipmi/ucenter/detail */
export async function getCoreClientIpmiUcenterDetail(
  // 叠加生成的Param类型 (非body参数swagger默认没有生成对象)
  params: APPAPI.getCoreClientIpmiUcenterDetailParams,
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
  }>('/core/client/ipmi/ucenter/detail', {
    method: 'GET',
    params: {
      ...params,
    },
    ...(options || {}),
  });
}

/** 保存应用在授权中心的信息 保存应用在授权中心的信息 返回值: Default Response POST /core/client/ipmi/ucenter/save */
export async function postCoreClientIpmiUcenterSave(
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
  }>('/core/client/ipmi/ucenter/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}

/** 修改单个应用 修改单个应用 返回值: Default Response POST /core/client/ipmi/update */
export async function postCoreClientIpmiUpdate(
  body: APPAPI.Client,
  options?: { [key: string]: any },
) {
  return request<{
    statusCode: number;
    code: number;
    msg?: string;
    errorLevel?: string;
    data?: Record<string, any>;
  }>('/core/client/ipmi/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
