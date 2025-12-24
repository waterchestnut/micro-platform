// @ts-ignore
/* eslint-disable */

declare namespace APPAPI {

  type ClientPublic = {
    /** 应用标识 */
    clientCode: string;
    /** 应用名称 */
    clientName?: string;
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
  };
}
