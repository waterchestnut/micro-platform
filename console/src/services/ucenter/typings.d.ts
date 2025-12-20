// @ts-ignore
/* eslint-disable */

declare namespace UCENTERAPI {

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
