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
      endpointType?: 'pc' | 'pcIframe' | 'miniNative' | 'miniH5';
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
    platformType?: 'xxzx' | 'union';
    /** 获得本应用授权的其他应用 */
    toClients?: string[];
    /** 应用图标 */
    logoUrl?: string;
    /** 是否默认显示在首页 */
    default2Home?: boolean;
  };

  type fullDefinitionModels = {
    /** Endpoint */
    Endpoint?: {
      endpointType?: 'pc' | 'pcIframe' | 'miniNative' | 'miniH5';
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
    EndpointTypeEnum?: { pc?: string; pcIframe?: string; miniNative?: string; miniH5?: string };
    /** HomeEndpointEnum */
    HomeEndpointEnum?: { pc?: string; mobile?: string };
    /** HomeTypeEnum */
    HomeTypeEnum?: { remove?: number; add?: number };
    /** PlatformTypeEnum */
    PlatformTypeEnum?: { xxzx?: string; union?: string };
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
        endpointType?: 'pc' | 'pcIframe' | 'miniNative' | 'miniH5';
        visitPath?: string;
        status?: -1 | 0 | 1;
      }[];
      needAuthProxy?: boolean;
      upstreams?: { host?: string; weight?: number }[];
      order?: number;
      needAuth2Show?: boolean;
      platformType?: 'xxzx' | 'union';
      toClients?: string[];
      logoUrl?: string;
      default2Home?: boolean;
    };
    /** HomeClient */
    HomeClient?: {
      homeClientCode: string;
      clientCode: string;
      order?: number;
      userCode?: string;
      homeEndpoint?: string;
      homeType?: string;
    };
    /** HomeWidget */
    HomeWidget?: {
      homeWidgetCode: string;
      widgetCode: string;
      order?: number;
      userCode?: string;
      homeEndpoint?: string;
      homeType?: string;
    };
    /** Widget */
    Widget?: {
      widgetCode: string;
      clientCode: string;
      widgetName?: string;
      logoUrl?: string;
      apiUrl?: string;
      miniApiUrl?: string;
      pcRedirectUrl?: string;
      miniRedirectUrl?: string;
      description?: string;
      order?: number;
      default2Home?: boolean;
      status?: -1 | 0 | 1;
      operator?: { userCode?: string; realName?: string };
      tags?: { key?: string; value?: string }[];
    };
  };

  type fullStoreModels = {
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
        endpointType?: 'pc' | 'pcIframe' | 'miniNative' | 'miniH5';
        visitPath?: string;
        status?: -1 | 0 | 1;
      }[];
      needAuthProxy?: boolean;
      upstreams?: { host?: string; weight?: number }[];
      order?: number;
      needAuth2Show?: boolean;
      platformType?: 'xxzx' | 'union';
      toClients?: string[];
      logoUrl?: string;
      default2Home?: boolean;
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
      homeEndpoint?: string;
      homeType?: string;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** HomeWidget */
    HomeWidget?: {
      homeWidgetCode: string;
      widgetCode: string;
      order?: number;
      userCode?: string;
      homeEndpoint?: string;
      homeType?: string;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** Widget */
    Widget?: {
      widgetCode: string;
      clientCode: string;
      widgetName?: string;
      logoUrl?: string;
      apiUrl?: string;
      miniApiUrl?: string;
      pcRedirectUrl?: string;
      miniRedirectUrl?: string;
      description?: string;
      order?: number;
      default2Home?: boolean;
      status?: -1 | 0 | 1;
      operator?: { userCode?: string; realName?: string };
      tags?: { key?: string; value?: string }[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
  };

  type getCoreClientIpmiDetailParams = {
    clientCode: string;
  };

  type getCoreClientIpmiListStatByTagParams = {
    /** 可选，按创建者筛选 */
    operatorUserCode?: string;
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

  type getCoreHomeClientListParams = {
    homeEndpoint?: string;
  };

  type getCoreHomeWidgetListParams = {
    homeEndpoint?: string;
  };

  type getCoreWidgetIpmiDetailParams = {
    widgetCode: string;
  };

  type getCoreWidgetMyDetailParams = {
    widgetCode: string;
  };

  type getPublicBinWidgetShowMiniParams = {
    clientCode?: string;
  };

  type getPublicBinWidgetShowPcParams = {
    clientCode?: string;
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
    /** 首页排布访问端 */
    homeEndpoint?: string;
    /** 首页排布类型 */
    homeType?: string;
  };

  type HomeWidget = {
    /** 排布标识 */
    homeWidgetCode: string;
    /** 小组件标识 */
    widgetCode: string;
    /** 排序 */
    order?: number;
    /** 排布的用户 */
    userCode?: string;
    /** 首页排布访问端 */
    homeEndpoint?: string;
    /** 首页排布类型 */
    homeType?: string;
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

  type Widget = {
    /** 小组件标识 */
    widgetCode: string;
    /** 所属应用标识 */
    clientCode: string;
    /** 小组件名称 */
    widgetName?: string;
    /** 小组件图标 */
    logoUrl?: string;
    /** 获取小组件内容的接口地址 */
    apiUrl?: string;
    /** 获取小组件内容的接口地址（小程序使用的代理后的地址），该地址只允许相对地址 */
    miniApiUrl?: string;
    /** PC端前端默认跳转地址 */
    pcRedirectUrl?: string;
    /** 小程序端前端默认跳转地址 */
    miniRedirectUrl?: string;
    /** 小组件描述 */
    description?: string;
    /** 排序 */
    order?: number;
    /** 是否默认显示在首页 */
    default2Home?: boolean;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 小组件创建者 */
    operator?: { userCode?: string; realName?: string };
    /** 标签 */
    tags?: { key?: string; value?: string }[];
  };
}
