import {Footer, AvatarDropdown, AvatarName} from '@/components';
import {LinkOutlined} from '@ant-design/icons';
import type {Settings as LayoutSettings} from '@ant-design/pro-components';
import {SettingDrawer} from '@ant-design/pro-components';
import type {RunTimeLayoutConfig} from '@umijs/max';
import {Link} from '@umijs/max';
import defaultSettings from '../config/defaultSettings';
import {errorConfig} from './requestErrorConfig';
import {queryCurrentUser} from '@/services/ucenter/user';
import React from 'react';
import {isEmbedded} from "@/utils/embed";
import {toLogin} from "@/utils/authority";

const isDev = process.env.NODE_ENV === 'development';

/**
 * @see  https://umijs.org/zh-CN/plugins/plugin-initial-state
 * */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: UCENTERAPI.UserInfoWithToken;
  loading?: boolean;
  fetchUserInfo?: () => Promise<UCENTERAPI.UserInfoWithToken | undefined>;
}> {
  // @ts-ignore
  console.log(window.$wujie?.props?.getUserCache())
  const fetchUserInfo = async (redirect = true) => {
    try {
      const msg = await queryCurrentUser();
      return msg.data;
    } catch (error) {
      if (redirect) {
        toLogin();
      }
    }
    return undefined;
  };
  // 加载用户信息
  const currentUser = await fetchUserInfo(false);

  return {
    fetchUserInfo,
    currentUser,
    settings: defaultSettings as Partial<LayoutSettings>,
  };
}

// ProLayout 支持的api https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({initialState, setInitialState}) => {
  return {
    actionsRender: () => [/*<Question key="doc"/>, <SelectLang key="SelectLang"/>*/],
    avatarProps: isEmbedded() ? undefined : {
      src: initialState?.currentUser?.avatarUrl,
      title: <AvatarName/>,
      render: (_, avatarChildren) => {
        return <AvatarDropdown>{avatarChildren}</AvatarDropdown>;
      },
    },
    waterMarkProps: {
      content: `${defaultSettings.title}${initialState?.currentUser?.realName ? '(' + initialState?.currentUser?.realName + ')' : ''}`,
      markStyle: {minHeight: 'calc(100vh - 250px)'}
    },
    contentStyle: {minHeight: 'calc(100vh - 180px)'},
    footerRender: () => <Footer/>,
    onPageChange: () => {
    },
    menu: {
      defaultOpenAll: true,
      ignoreFlatMenu: true,
    },
    bgLayoutImgList: [
      {
        src: '/images/bgLayoutImg1.webp',
        left: 85,
        bottom: 100,
        height: '303px',
      },
      {
        src: '/images/bgLayoutImg2.webp',
        bottom: -68,
        right: -45,
        height: '303px',
      },
      {
        src: '/images/bgLayoutImg3.webp',
        bottom: 0,
        left: 0,
        width: '331px',
      },
    ],
    links: isDev
      ? [
        <Link key="openapi" to="/umi/plugin/openapi" target="_blank">
          <LinkOutlined/>
          <span>OpenAPI 文档</span>
        </Link>,
      ]
      : [],
    menuHeaderRender: undefined,
    // 自定义 403 页面
    // unAccessible: <div>unAccessible</div>,
    // 增加一个 loading 的状态
    childrenRender: (children) => {
      // if (initialState?.loading) return <PageLoading />;
      return (
        <>
          {children}
          {isDev && (
            <SettingDrawer
              disableUrlParams
              enableDarkTheme
              settings={initialState?.settings}
              onSettingChange={(settings) => {
                setInitialState((preInitialState) => ({
                  ...preInitialState,
                  settings,
                }));
              }}
            />
          )}
        </>
      );
    },
    ...initialState?.settings,
    layout: isEmbedded() ? 'side' : 'mix',
    /*appList: [{title: '测试', url: 'https://www.bing.com'}],*/
    logo: isEmbedded() ? '/logo.svg' : '/logo_white.svg',
  };
};

/**
 * @name request 配置，可以配置错误处理
 * 它基于 axios 和 ahooks 的 useRequest 提供了一套统一的网络请求和错误处理方案。
 * @doc https://umijs.org/docs/max/request#配置
 */
export const request = {
  ...errorConfig,
};
