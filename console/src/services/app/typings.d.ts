// @ts-ignore
/* eslint-disable */

declare namespace APPAPI {

  type ClientPublic = {
    /** 应用标识 */
    clientCode: string;
    /** 应用名称 */
    clientName?: string;
    /** 应用英文名称（i18n-menu-label-en） */
    nameEn?: string;
    /** 状态 */
    status?: -1 | 0 | 1;
    /** 应用描述 */
    description?: string;
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
    /** 排序 */
    order?: number;
    /** 是否需要分配权限才显示 */
    needAuth2Show?: boolean;
    /** 平台类型 */
    platformType?: 'micro' | 'union';
    /** 是否默认显示在首页 */
    default2Home?: boolean;
  };

  type Tag = {
    key?: string;
    value?: string;
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
    /** 标签 */
    tags?: { key?: string; value?: string }[];
  };
}
