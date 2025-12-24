declare namespace APPAPI {
  type Client = {
    /** 应用标识 */
    clientCode: string;
    /** 应用名称 */
    clientName?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 应用描述 */
    description?: string;
    /** 应用创建者 */
    operator?: { userCode?: string; realName?: string };
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 应用类型 */
    clientType?: 'builtIn' | 'official' | 'thirdParty' | 'selfBuild' | 'community';
    /** 访问端 */
    endpoints?: {
      endpointType?: 'pc' | 'miniNative' | 'miniH5';
      visitPath?: string;
      status?: -1 | 0 | 1;
    }[];
    /** 是否需要代理权限验证 */
    needAuthProxy?: boolean;
    /** 上游节点 */
    upstreams?: { host?: string; weight?: number }[];
    /** 排序 */
    order?: number;
    /** 是否需要分配权限才显示 */
    needAuth2Show?: boolean;
    /** 平台类型 */
    platformType?: 'micro' | 'union';
    /** 获得本应用授权的其他应用 */
    toClients?: string[];
  };

  type fullDefinitionModels = {
    /** Endpoint */
    Endpoint?: {
      endpointType?: 'pc' | 'miniNative' | 'miniH5';
      visitPath?: string;
      status?: -1 | 0 | 1;
    };
    /** Operator */
    Operator?: { userCode?: string; realName?: string };
    /** Tag */
    Tag?: { key?: string; value?: string };
    /** Upstream */
    Upstream?: { host?: string; weight?: number };
  };

  type fullEnumModels = {
    /** ClientTypeEnum */
    ClientTypeEnum?: {
      builtIn?: string;
      official?: string;
      thirdParty?: string;
      selfBuild?: string;
      community?: string;
    };
    /** EndpointTypeEnum */
    EndpointTypeEnum?: { pc?: string; miniNative?: string; miniH5?: string };
    /** PlatformTypeEnum */
    PlatformTypeEnum?: { micro?: string; union?: string };
    /** StatusEnum */
    StatusEnum?: { deleted?: number; normal?: number; disabled?: number };
  };

  type fullParamModels = {
    /** Client */
    Client?: {
      clientCode: string;
      clientName?: string;
      status?: -1 | 0 | 1;
      description?: string;
      operator?: { userCode?: string; realName?: string };
      tags?: { key?: string; value?: string }[];
      clientType?: 'builtIn' | 'official' | 'thirdParty' | 'selfBuild' | 'community';
      endpoints?: {
        endpointType?: 'pc' | 'miniNative' | 'miniH5';
        visitPath?: string;
        status?: -1 | 0 | 1;
      }[];
      needAuthProxy?: boolean;
      upstreams?: { host?: string; weight?: number }[];
      order?: number;
      needAuth2Show?: boolean;
      platformType?: 'micro' | 'union';
      toClients?: string[];
    };
    /** HomeClient */
    HomeClient?: { homeClientCode: string; clientCode: string; order?: number; userCode?: string };
  };

  type fullStoreModels = {
    /** Client */
    Client?: {
      clientCode: string;
      clientName?: string;
      status?: -1 | 0 | 1;
      description?: string;
      operator?: { userCode?: string; realName?: string; _id?: string };
      tags?: { key?: string; value?: string; _id?: string }[];
      clientType?: 'builtIn' | 'official' | 'thirdParty' | 'selfBuild' | 'community';
      endpoints?: {
        endpointType?: 'pc' | 'miniNative' | 'miniH5';
        visitPath?: string;
        status?: -1 | 0 | 1;
        _id?: string;
      }[];
      needAuthProxy?: boolean;
      upstreams?: { host?: string; weight?: number; _id?: string }[];
      order?: number;
      needAuth2Show?: boolean;
      platformType?: 'micro' | 'union';
      toClients?: string[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** HomeClient */
    HomeClient?: {
      homeClientCode: string;
      clientCode: string;
      order?: number;
      userCode?: string;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
  };

  type getCoreClientIpmiDetailParams = {
    clientCode: string;
  };

  type getCoreClientIpmiModuleListParams = {
    clientCode: string;
  };

  type getCoreClientIpmiPageListParams = {
    clientCode: string;
  };

  type getCoreClientIpmiPrivGroupListParams = {
    clientCode: string;
  };

  type getCoreClientIpmiPrivListParams = {
    clientCode: string;
  };

  type getCoreClientIpmiUcenterDetailParams = {
    clientCode: string;
  };

  type getCoreClientMyDetailParams = {
    clientCode: string;
  };

  type getCoreClientMyModuleListParams = {
    clientCode: string;
  };

  type getCoreClientMyPageListParams = {
    clientCode: string;
  };

  type getCoreClientMyPrivGroupListParams = {
    clientCode: string;
  };

  type getCoreClientMyPrivListParams = {
    clientCode: string;
  };

  type getCoreClientMyUcenterDetailParams = {
    clientCode: string;
  };

  type HomeClient = {
    /** 排布标识 */
    homeClientCode: string;
    /** 应用标识 */
    clientCode: string;
    /** 排序 */
    order?: number;
    /** 排布的用户 */
    userCode?: string;
  };

  type postCoreClientIpmiModule_openAPI_deleteParams = {
    clientCode: string;
  };

  type postCoreClientIpmiModuleAddParams = {
    clientCode: string;
  };

  type postCoreClientIpmiPageSaveParams = {
    clientCode: string;
  };

  type postCoreClientIpmiPriv_openAPI_deleteParams = {
    clientCode: string;
  };

  type postCoreClientIpmiPrivAddParams = {
    clientCode: string;
  };

  type postCoreClientIpmiPrivGroupSavePrivParams = {
    clientCode: string;
  };

  type postCoreClientIpmiPrivOtherClientListParams = {
    clientCode: string;
  };

  type postCoreClientIpmiPrivOtherClientSavePrivParams = {
    clientCode: string;
  };

  type postCoreClientMyModule_openAPI_deleteParams = {
    clientCode: string;
  };

  type postCoreClientMyModuleAddParams = {
    clientCode: string;
  };

  type postCoreClientMyPageSaveParams = {
    clientCode: string;
  };

  type postCoreClientMyPriv_openAPI_deleteParams = {
    clientCode: string;
  };

  type postCoreClientMyPrivAddParams = {
    clientCode: string;
  };

  type postCoreClientMyPrivGroupSavePrivParams = {
    clientCode: string;
  };

  type postCoreClientMyPrivOtherClientListParams = {
    clientCode: string;
  };

  type postCoreClientMyPrivOtherClientSavePrivParams = {
    clientCode: string;
  };
}
