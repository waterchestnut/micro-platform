declare namespace UCENTERAPI {
  type AccessToken = {
    /** accessToken的值 */
    accessToken: string;
    /** 应用标识 */
    clientCode?: string;
    /** 用户标识 */
    userCode?: string;
    /** 过期时间 */
    expiresTime?: number;
    /** 授权范围 */
    scopes?: string[];
    /** 应用回调地址 */
    retUrl?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** OAuth认证类型 */
    oauthType?: 0 | 1 | 2;
  };

  type AuthCode = {
    /** code的值 */
    authCode: string;
    /** 应用标识 */
    clientCode?: string;
    /** 用户标识 */
    userCode?: string;
    /** 过期时间 */
    expiresTime?: number;
    /** 授权范围 */
    scopes?: string[];
    /** 应用回调地址 */
    retUrl?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** OAuth认证类型 */
    oauthType?: 0 | 1 | 2;
  };

  type Client = {
    /** 应用标识 */
    clientCode: string;
    /** 应用名称 */
    clientName: string;
    /** 应用秘钥 */
    clientSecret: string;
    /** 授权后的回调地址 */
    retUrls?: string[];
    /** 授权模式 */
    grantTypes?: ('code' | 'token' | 'password' | 'clientCredentials')[];
    /** 授权范围 */
    scopes?: ('myRead' | 'myWrite' | 'admin')[];
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 应用描述 */
    description?: string;
    /** 添加应用的人 */
    userCode?: string;
    /** 应用登录地址 */
    loginUrls?: string[];
    /** 应用退出地址 */
    logoutUrls?: string[];
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 模块权限标识 */
    modulePrivCodes?: string[];
  };

  type Department = {
    /** 部门标识 */
    departmentCode: string;
    /** 部门名称 */
    departmentName: string;
    /** 父部门标识 */
    parentCode?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 部门层级 */
    levelNum?: number;
    /** 部门排序 */
    orderNum?: number;
    /** 所属机构 */
    orgCode?: string;
    /** 部门既有的行政编号，机构内唯一 */
    adminCode?: string;
    /** 从顶级到当前部门的全路径标识 */
    path?: string[];
    /** 是否临时组织 */
    isTemp?: number;
  };

  type fullDefinitionModels = {
    /** Address */
    Address?: {
      continent?: string;
      continentName?: string;
      country?: string;
      countryName?: string;
      province?: string;
      provinceName?: string;
      city?: string;
      cityName?: string;
      district?: string;
      districtName?: string;
      content?: string;
    };
    /** Contact */
    Contact?: {
      realName?: string;
      mobile?: string;
      phone?: string;
      postcode?: string;
      email?: string;
    };
    /** Tag */
    Tag?: { key?: string; value?: string };
    /** UserDepartment */
    UserDepartment?: {
      userCode?: string;
      departmentCode?: string;
      jobCode?: string;
      jobStatus?: string;
    };
  };

  type fullEnumModels = {
    /** AuthTypeEnum */
    AuthTypeEnum?: { managed?: number; builtIn?: number; trail?: number; store?: number };
    /** DegreeEnum */
    DegreeEnum?: {
      notSet?: number;
      professional?: number;
      undergraduate?: number;
      master?: number;
      doctor?: number;
    };
    /** GenderEnum */
    GenderEnum?: { notSet?: number; male?: number; female?: number };
    /** OAuthGrantTypeEnum */
    OAuthGrantTypeEnum?: {
      code?: string;
      token?: string;
      password?: string;
      clientCredentials?: string;
    };
    /** OAuthScopeEnum */
    OAuthScopeEnum?: { myRead?: string; myWrite?: string; admin?: string };
    /** OAuthTypeEnum */
    OAuthTypeEnum?: { user?: number; client?: number; clientUser?: number };
    /** OrgTypeEnum */
    OrgTypeEnum?: {
      other?: string;
      school?: string;
      arbitration?: string;
      court?: string;
      legal?: string;
    };
    /** PrivVerbEnum */
    PrivVerbEnum?: {
      browse?: string;
      get?: string;
      list?: string;
      create?: string;
      update?: string;
      delete?: string;
    };
    /** SchemaEnum */
    SchemaEnum?: { default?: string; store?: string };
    /** StatusEnum */
    StatusEnum?: { deleted?: number; normal?: number; disabled?: number };
  };

  type fullParamModels = {
    /** AccessToken */
    AccessToken?: {
      accessToken: string;
      clientCode?: string;
      userCode?: string;
      expiresTime?: number;
      scopes?: string[];
      retUrl?: string;
      status?: -1 | 0 | 1;
      oauthType?: 0 | 1 | 2;
    };
    /** AuthCode */
    AuthCode?: {
      authCode: string;
      clientCode?: string;
      userCode?: string;
      expiresTime?: number;
      scopes?: string[];
      retUrl?: string;
      status?: -1 | 0 | 1;
      oauthType?: 0 | 1 | 2;
    };
    /** Client */
    Client?: {
      clientCode: string;
      clientName: string;
      clientSecret: string;
      retUrls?: string[];
      grantTypes?: ('code' | 'token' | 'password' | 'clientCredentials')[];
      scopes?: ('myRead' | 'myWrite' | 'admin')[];
      status?: -1 | 0 | 1;
      description?: string;
      userCode?: string;
      loginUrls?: string[];
      logoutUrls?: string[];
      tags?: { key?: string; value?: string }[];
      modulePrivCodes?: string[];
    };
    /** Department */
    Department?: {
      departmentCode: string;
      departmentName: string;
      parentCode?: string;
      status?: -1 | 0 | 1;
      levelNum?: number;
      orderNum?: number;
      orgCode?: string;
      adminCode?: string;
      path?: string[];
      isTemp?: number;
    };
    /** Group */
    Group?: {
      groupCode: string;
      groupName: string;
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      modulePrivCodes?: string[];
      orgCode?: string;
      description?: string;
      schemaCodes?: ('default' | 'store')[];
      tags?: { key?: string; value?: string }[];
    };
    /** Job */
    Job?: {
      jobCode: string;
      jobName: string;
      parentCode?: string;
      status?: -1 | 0 | 1;
      levelNum?: number;
      orderNum?: number;
      orgCode?: string;
      adminCode?: string;
      path?: string[];
    };
    /** MobileRange */
    MobileRange?: {
      mobileRangeCode: string;
      startNumber?: number;
      endNumber?: number;
      provName?: string;
      cityName?: string;
      areaCode?: string;
      status?: -1 | 0 | 1;
    };
    /** Module */
    Module?: {
      moduleCode: string;
      moduleName: string;
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      clientCode?: string;
    };
    /** ModulePriv */
    ModulePriv?: {
      modulePrivCode: string;
      modulePrivName: string;
      moduleCode: string;
      privVerb: 'browse' | 'get' | 'list' | 'create' | 'update' | 'delete';
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      clientCode?: string;
    };
    /** OrgInfo */
    OrgInfo?: {
      orgCode: string;
      orgName: string;
      orgNameEn?: string;
      coverUrl?: string;
      firstLetter?: string;
      letters?: string;
      pinyin?: string;
      des?: string;
      desEn?: string;
      address?: {
        continent?: string;
        continentName?: string;
        country?: string;
        countryName?: string;
        province?: string;
        provinceName?: string;
        city?: string;
        cityName?: string;
        district?: string;
        districtName?: string;
        content?: string;
      };
      contactList?: {
        realName?: string;
        mobile?: string;
        phone?: string;
        postcode?: string;
        email?: string;
      }[];
      orgTypes?: ('other' | 'school' | 'arbitration' | 'court' | 'legal')[];
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      schemaCodes?: ('default' | 'store')[];
    };
    /** PageConfig */
    PageConfig?: {
      pageConfigCode: string;
      clientCode?: string;
      name?: string;
      path: string;
      method: string[];
      auth?: boolean;
      clientAuth?: boolean;
      privs?: string[];
      clientPrivs?: string[];
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
      orderNum?: number;
    };
    /** RefreshToken */
    RefreshToken?: {
      refreshToken: string;
      clientCode?: string;
      userCode?: string;
      expiresTime?: number;
      scopes?: string[];
      retUrl?: string;
      status?: -1 | 0 | 1;
      oauthType?: 0 | 1 | 2;
    };
    /** Region */
    Region?: {
      regionCode: string;
      regionName: string;
      fullName?: string;
      parentCode?: string;
      status?: -1 | 0 | 1;
      levelNum?: number;
      orderNum?: number;
      adminCode?: string;
      path?: string[];
      typeName?: string;
      nameEn?: string;
      shortName?: string;
      shortNameEn?: string;
      firstLetter?: string;
      letters?: string;
      pinyin?: string;
      extra?: string;
    };
    /** UserInfo */
    UserInfo?: {
      userCode: string;
      loginName?: string;
      mobile?: string;
      email?: string;
      mobileList?: string[];
      phoneList?: string[];
      emailList?: string[];
      realName?: string;
      nickName?: string;
      avatarUrl?: string;
      office?: string;
      nation?: string;
      politics?: string;
      birthday?: string;
      orderNum?: number;
      degree?: 0 | 1 | 2 | 3 | 4;
      gender?: 0 | 1 | 2;
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      schemaCodes?: ('default' | 'store')[];
      orgCodes?: string[];
      tags?: { key?: string; value?: string }[];
      modulePrivCodes?: string[];
      groupCodes?: string[];
      departments?: {
        userCode?: string;
        departmentCode?: string;
        jobCode?: string;
        jobStatus?: string;
      }[];
      mainJobCode?: string;
    };
    /** UserInfoWithToken */
    UserInfoWithToken?: {
      userCode: string;
      loginName?: string;
      mobile?: string;
      email?: string;
      mobileList?: string[];
      phoneList?: string[];
      emailList?: string[];
      realName?: string;
      nickName?: string;
      avatarUrl?: string;
      office?: string;
      nation?: string;
      politics?: string;
      birthday?: string;
      orderNum?: number;
      degree?: 0 | 1 | 2 | 3 | 4;
      gender?: 0 | 1 | 2;
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      schemaCodes?: ('default' | 'store')[];
      orgCodes?: string[];
      tags?: { key?: string; value?: string }[];
      modulePrivCodes?: string[];
      groupCodes?: string[];
      departments?: {
        userCode?: string;
        departmentCode?: string;
        jobCode?: string;
        jobStatus?: string;
      }[];
      mainJobCode?: string;
      accessToken?: string;
      expiresTime?: number;
      refreshToken?: string;
      privs?: string[];
    };
    /** ModuleFormatted */
    ModuleFormatted?: {
      moduleCode: string;
      moduleName: string;
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      clientCode?: string;
      clientName?: string;
    };
    /** ModulePrivFormatted */
    ModulePrivFormatted?: {
      modulePrivCode: string;
      modulePrivName: string;
      moduleCode: string;
      privVerb: 'browse' | 'get' | 'list' | 'create' | 'update' | 'delete';
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      clientCode?: string;
      moduleName?: string;
      clientName?: string;
    };
    /** PageConfigFormatted */
    PageConfigFormatted?: {
      pageConfigCode: string;
      clientCode?: string;
      name?: string;
      path: string;
      method: string[];
      auth?: boolean;
      clientAuth?: boolean;
      privs?: string[];
      clientPrivs?: string[];
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string }[];
      orderNum?: number;
      clientName?: string;
    };
  };

  type fullStoreModels = {
    /** AccessToken */
    AccessToken?: {
      accessToken: string;
      clientCode?: string;
      userCode?: string;
      expiresTime?: number;
      scopes?: string[];
      retUrl?: string;
      status?: -1 | 0 | 1;
      oauthType?: 0 | 1 | 2;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** AuthCode */
    AuthCode?: {
      authCode: string;
      clientCode?: string;
      userCode?: string;
      expiresTime?: number;
      scopes?: string[];
      retUrl?: string;
      status?: -1 | 0 | 1;
      oauthType?: 0 | 1 | 2;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** Client */
    Client?: {
      clientCode: string;
      clientName: string;
      clientSecret: string;
      retUrls?: string[];
      grantTypes?: ('code' | 'token' | 'password' | 'clientCredentials')[];
      scopes?: ('myRead' | 'myWrite' | 'admin')[];
      status?: -1 | 0 | 1;
      description?: string;
      userCode?: string;
      loginUrls?: string[];
      logoutUrls?: string[];
      tags?: { key?: string; value?: string; _id?: string }[];
      modulePrivCodes?: string[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** Department */
    Department?: {
      departmentCode: string;
      departmentName: string;
      parentCode?: string;
      status?: -1 | 0 | 1;
      levelNum?: number;
      orderNum?: number;
      orgCode?: string;
      adminCode?: string;
      path?: string[];
      isTemp?: number;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** Group */
    Group?: {
      groupCode: string;
      groupName: string;
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      modulePrivCodes?: string[];
      orgCode?: string;
      description?: string;
      schemaCodes?: ('default' | 'store')[];
      tags?: { key?: string; value?: string; _id?: string }[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** Job */
    Job?: {
      jobCode: string;
      jobName: string;
      parentCode?: string;
      status?: -1 | 0 | 1;
      levelNum?: number;
      orderNum?: number;
      orgCode?: string;
      adminCode?: string;
      path?: string[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** MobileRange */
    MobileRange?: {
      mobileRangeCode: string;
      startNumber?: number;
      endNumber?: number;
      provName?: string;
      cityName?: string;
      areaCode?: string;
      status?: -1 | 0 | 1;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** Module */
    Module?: {
      moduleCode: string;
      moduleName: string;
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      clientCode?: string;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** ModulePriv */
    ModulePriv?: {
      modulePrivCode: string;
      modulePrivName: string;
      moduleCode: string;
      privVerb: 'browse' | 'get' | 'list' | 'create' | 'update' | 'delete';
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      clientCode?: string;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** OrgInfo */
    OrgInfo?: {
      orgCode: string;
      orgName: string;
      orgNameEn?: string;
      coverUrl?: string;
      firstLetter?: string;
      letters?: string;
      pinyin?: string;
      des?: string;
      desEn?: string;
      address?: {
        continent?: string;
        continentName?: string;
        country?: string;
        countryName?: string;
        province?: string;
        provinceName?: string;
        city?: string;
        cityName?: string;
        district?: string;
        districtName?: string;
        content?: string;
        _id?: string;
      };
      contactList?: {
        realName?: string;
        mobile?: string;
        phone?: string;
        postcode?: string;
        email?: string;
        _id?: string;
      }[];
      orgTypes?: ('other' | 'school' | 'arbitration' | 'court' | 'legal')[];
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      schemaCodes?: ('default' | 'store')[];
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** PageConfig */
    PageConfig?: {
      pageConfigCode: string;
      clientCode?: string;
      name?: string;
      path: string;
      method: string[];
      auth?: boolean;
      clientAuth?: boolean;
      privs?: string[];
      clientPrivs?: string[];
      status?: -1 | 0 | 1;
      tags?: { key?: string; value?: string; _id?: string }[];
      orderNum?: number;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** RefreshToken */
    RefreshToken?: {
      refreshToken: string;
      clientCode?: string;
      userCode?: string;
      expiresTime?: number;
      scopes?: string[];
      retUrl?: string;
      status?: -1 | 0 | 1;
      oauthType?: 0 | 1 | 2;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** Region */
    Region?: {
      regionCode: string;
      regionName: string;
      fullName?: string;
      parentCode?: string;
      status?: -1 | 0 | 1;
      levelNum?: number;
      orderNum?: number;
      adminCode?: string;
      path?: string[];
      typeName?: string;
      nameEn?: string;
      shortName?: string;
      shortNameEn?: string;
      firstLetter?: string;
      letters?: string;
      pinyin?: string;
      extra?: string;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
    /** UserInfo */
    UserInfo?: {
      userCode: string;
      loginName?: string;
      pwd?: string;
      mobile?: string;
      email?: string;
      mobileList?: string[];
      phoneList?: string[];
      emailList?: string[];
      realName?: string;
      nickName?: string;
      avatarUrl?: string;
      office?: string;
      nation?: string;
      politics?: string;
      birthday?: string;
      orderNum?: number;
      degree?: 0 | 1 | 2 | 3 | 4;
      gender?: 0 | 1 | 2;
      status?: -1 | 0 | 1;
      authType?: 0 | 1 | 2 | 3;
      schemaCodes?: ('default' | 'store')[];
      orgCodes?: string[];
      tags?: { key?: string; value?: string; _id?: string }[];
      modulePrivCodes?: string[];
      groupCodes?: string[];
      departments?: {
        userCode?: string;
        departmentCode?: string;
        jobCode?: string;
        jobStatus?: string;
        _id?: string;
      }[];
      mainJobCode?: string;
      insertTime?: string;
      updateTime?: string;
      _id?: string;
    };
  };

  type getClientProxyOauthCallbackParams = {
    retUrl?: string;
    state?: string;
    authCode?: string;
    error?: number;
    msg?: string;
  };

  type getClientProxyOauthLogoutParams = {
    loginType?: string;
  };

  type getClientProxyOauthSignInParams = {
    accessToken: string;
    refreshToken?: string;
  };

  type getCoreCaptchaParams = {
    /** 验证码key，刷新验证码时传递，第一次获取会自动生成 */
    captchaKey?: string;
  };

  type getCoreClientIpmiDetailParams = {
    clientCode: string;
  };

  type getCoreOrgIpmiDetailParams = {
    orgCode: string;
  };

  type getCoreUserIpmiDetailParams = {
    userCode: string;
  };

  type getExampleIdParams = {
    id: string;
  };

  type getOauthAuthorizeParams = {
    clientCode: string;
    state: string;
    retUrl: string;
  };

  type getOauthLogoutParams = {
    clientCode: string;
    state: string;
    retUrl: string;
  };

  type getParams = {
    userCode: string;
  };

  type getPublicBinMobileRangeCheckParams = {
    phone: string;
  };

  type Group = {
    /** 用户组标识 */
    groupCode: string;
    /** 用户组名称 */
    groupName: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 授权类型 */
    authType?: 0 | 1 | 2 | 3;
    /** 模块权限标识 */
    modulePrivCodes?: string[];
    /** 所属机构 */
    orgCode?: string;
    /** 描述备注 */
    description?: string;
    /** 使用模式 */
    schemaCodes?: ('default' | 'store')[];
    /** 标签 */
    tags?: { key?: string; value?: string }[];
  };

  type Job = {
    /** 职位标识 */
    jobCode: string;
    /** 职位名称 */
    jobName: string;
    /** 父职位标识 */
    parentCode?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 职位层级 */
    levelNum?: number;
    /** 职位排序 */
    orderNum?: number;
    /** 所属机构 */
    orgCode?: string;
    /** 职位既有的行政编号，机构内唯一 */
    adminCode?: string;
    /** 从顶级到当前职位的全路径标识 */
    path?: string[];
  };

  type MobileRange = {
    /** 号码段记录标识 */
    mobileRangeCode: string;
    startNumber?: number;
    endNumber?: number;
    provName?: string;
    cityName?: string;
    areaCode?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
  };

  type Module = {
    /** 模块标识 */
    moduleCode: string;
    /** 模块名称 */
    moduleName: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 授权类型 */
    authType?: 0 | 1 | 2 | 3;
    /** 所属应用标识 */
    clientCode?: string;
  };

  type ModuleFormatted = {
    /** 模块标识 */
    moduleCode: string;
    /** 模块名称 */
    moduleName: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 授权类型 */
    authType?: 0 | 1 | 2 | 3;
    /** 所属应用标识 */
    clientCode?: string;
    clientName?: string;
  };

  type ModulePriv = {
    /** 模块权限标识 */
    modulePrivCode: string;
    /** 模块权限名称 */
    modulePrivName: string;
    /** 模块标识 */
    moduleCode: string;
    /** 权限动作 */
    privVerb: 'browse' | 'get' | 'list' | 'create' | 'update' | 'delete';
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 授权类型 */
    authType?: 0 | 1 | 2 | 3;
    /** 所属应用标识 */
    clientCode?: string;
  };

  type ModulePrivFormatted = {
    /** 模块权限标识 */
    modulePrivCode: string;
    /** 模块权限名称 */
    modulePrivName: string;
    /** 模块标识 */
    moduleCode: string;
    /** 权限动作 */
    privVerb: 'browse' | 'get' | 'list' | 'create' | 'update' | 'delete';
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 授权类型 */
    authType?: 0 | 1 | 2 | 3;
    /** 所属应用标识 */
    clientCode?: string;
    moduleName?: string;
    clientName?: string;
  };

  type OrgInfo = {
    /** 机构标识 */
    orgCode: string;
    /** 机构名称 */
    orgName: string;
    /** 英文名称 */
    orgNameEn?: string;
    /** 封面地址 */
    coverUrl?: string;
    /** 机构名称第一个首字母 */
    firstLetter?: string;
    /** 机构名称首字母集合 */
    letters?: string;
    /** 机构名称拼音 */
    pinyin?: string;
    /** 机构介绍 */
    des?: string;
    /** 英文介绍 */
    desEn?: string;
    /** 坐落地址 */
    address?: {
      continent?: string;
      continentName?: string;
      country?: string;
      countryName?: string;
      province?: string;
      provinceName?: string;
      city?: string;
      cityName?: string;
      district?: string;
      districtName?: string;
      content?: string;
    };
    /** 联系人 */
    contactList?: {
      realName?: string;
      mobile?: string;
      phone?: string;
      postcode?: string;
      email?: string;
    }[];
    /** 机构类型 */
    orgTypes?: ('other' | 'school' | 'arbitration' | 'court' | 'legal')[];
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 授权类型 */
    authType?: 0 | 1 | 2 | 3;
    /** 使用模式 */
    schemaCodes?: ('default' | 'store')[];
  };

  type PageConfig = {
    /** 配置标识 */
    pageConfigCode: string;
    /** 所属应用标识 */
    clientCode?: string;
    /** 名称 */
    name?: string;
    /** 请求路径 */
    path: string;
    /** 请求方法 */
    method: string[];
    /** 是否用户登录才能访问 */
    auth?: boolean;
    /** 是否第三方客户端登录才能访问 */
    clientAuth?: boolean;
    /** 登录的用户拥有什么权限才能访问 */
    privs?: string[];
    /** 登录的第三方客户端拥有什么权限才能访问 */
    clientPrivs?: string[];
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 排序 */
    orderNum?: number;
  };

  type PageConfigFormatted = {
    /** 配置标识 */
    pageConfigCode: string;
    /** 所属应用标识 */
    clientCode?: string;
    /** 名称 */
    name?: string;
    /** 请求路径 */
    path: string;
    /** 请求方法 */
    method: string[];
    /** 是否用户登录才能访问 */
    auth?: boolean;
    /** 是否第三方客户端登录才能访问 */
    clientAuth?: boolean;
    /** 登录的用户拥有什么权限才能访问 */
    privs?: string[];
    /** 登录的第三方客户端拥有什么权限才能访问 */
    clientPrivs?: string[];
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 排序 */
    orderNum?: number;
    clientName?: string;
  };

  type RefreshToken = {
    /** refreshToken的值 */
    refreshToken: string;
    /** 应用标识 */
    clientCode?: string;
    /** 用户标识 */
    userCode?: string;
    /** 过期时间 */
    expiresTime?: number;
    /** 授权范围 */
    scopes?: string[];
    /** 应用回调地址 */
    retUrl?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** OAuth认证类型 */
    oauthType?: 0 | 1 | 2;
  };

  type Region = {
    /** 区域标识 */
    regionCode: string;
    /** 区域名称 */
    regionName: string;
    /** 全名 */
    fullName?: string;
    /** 父区域标识 */
    parentCode?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 区域层级 */
    levelNum?: number;
    /** 区域排序 */
    orderNum?: number;
    /** 区域既有的行政编号，机构内唯一 */
    adminCode?: string;
    /** 从顶级到当前区域的全路径标识 */
    path?: string[];
    /** 区域类型名称 */
    typeName?: string;
    /** 区域的英文名称 */
    nameEn?: string;
    /** 区域的缩略名称 */
    shortName?: string;
    /** 区域的缩略英文名称 */
    shortNameEn?: string;
    /** 区域第一个首字母 */
    firstLetter?: string;
    /** 区域首字母集合 */
    letters?: string;
    /** 区域中文拼音 */
    pinyin?: string;
    /** 区域附加信息 */
    extra?: string;
  };

  type UserInfo = {
    /** 用户名 */
    userCode: string;
    /** 自定义登录名 */
    loginName?: string;
    /** 手机号 */
    mobile?: string;
    /** 邮箱 */
    email?: string;
    /** 联系手机号 */
    mobileList?: string[];
    /** 联系固定电话 */
    phoneList?: string[];
    /** 联系邮箱 */
    emailList?: string[];
    /** 姓名 */
    realName?: string;
    /** 昵称 */
    nickName?: string;
    /** 头像 */
    avatarUrl?: string;
    /** 办公地址 */
    office?: string;
    /** 民族 */
    nation?: string;
    /** 政治面貌 */
    politics?: string;
    /** 生日 */
    birthday?: string;
    /** 排序 */
    orderNum?: number;
    /** 学位 */
    degree?: 0 | 1 | 2 | 3 | 4;
    /** 性别 */
    gender?: 0 | 1 | 2;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 授权类型 */
    authType?: 0 | 1 | 2 | 3;
    /** 使用模式 */
    schemaCodes?: ('default' | 'store')[];
    /** 所属机构 */
    orgCodes?: string[];
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 模块权限标识 */
    modulePrivCodes?: string[];
    /** 所属用户组 */
    groupCodes?: string[];
    /** 所属部门 */
    departments?: {
      userCode?: string;
      departmentCode?: string;
      jobCode?: string;
      jobStatus?: string;
    }[];
    /** 主职位标识 */
    mainJobCode?: string;
  };

  type UserInfoWithToken = {
    /** 用户名 */
    userCode: string;
    /** 自定义登录名 */
    loginName?: string;
    /** 手机号 */
    mobile?: string;
    /** 邮箱 */
    email?: string;
    /** 联系手机号 */
    mobileList?: string[];
    /** 联系固定电话 */
    phoneList?: string[];
    /** 联系邮箱 */
    emailList?: string[];
    /** 姓名 */
    realName?: string;
    /** 昵称 */
    nickName?: string;
    /** 头像 */
    avatarUrl?: string;
    /** 办公地址 */
    office?: string;
    /** 民族 */
    nation?: string;
    /** 政治面貌 */
    politics?: string;
    /** 生日 */
    birthday?: string;
    /** 排序 */
    orderNum?: number;
    /** 学位 */
    degree?: 0 | 1 | 2 | 3 | 4;
    /** 性别 */
    gender?: 0 | 1 | 2;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 授权类型 */
    authType?: 0 | 1 | 2 | 3;
    /** 使用模式 */
    schemaCodes?: ('default' | 'store')[];
    /** 所属机构 */
    orgCodes?: string[];
    /** 标签 */
    tags?: { key?: string; value?: string }[];
    /** 模块权限标识 */
    modulePrivCodes?: string[];
    /** 所属用户组 */
    groupCodes?: string[];
    /** 所属部门 */
    departments?: {
      userCode?: string;
      departmentCode?: string;
      jobCode?: string;
      jobStatus?: string;
    }[];
    /** 主职位标识 */
    mainJobCode?: string;
    accessToken?: string;
    expiresTime?: number;
    refreshToken?: string;
    privs?: string[];
  };
}
