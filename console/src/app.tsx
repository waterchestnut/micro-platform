import {AvatarDropdown, AvatarName, Footer} from '@/components'
import {HomeOutlined, LinkOutlined, MenuOutlined} from '@ant-design/icons'
import type {Settings as LayoutSettings} from '@ant-design/pro-components'
import {SettingDrawer} from '@ant-design/pro-components'
import {Link, RunTimeLayoutConfig} from '@umijs/max'
import defaultSettings from '../config/defaultSettings'
import {errorConfig} from './requestErrorConfig'
import {queryCurrentUser} from '@/services/ucenter/user'
import React from 'react'
import {checkPermissions, toLogin} from '@/utils/authority'
import {getPCShowClients} from '@/services/app/client'
import {Button} from 'antd'
import AppsMenuButton from '@/components/AppsPop/AppsMenuButton'

const isDev = process.env.NODE_ENV === 'development'

function menuDataRender(menuList: any[], currentPrivs: any[]) {
  return menuList
    .map((menuItem: any) => {
      if (menuItem.routes) {
        if (checkPermissions(menuItem.authority, currentPrivs)) {
          menuItem.routes = menuDataRender(menuItem.routes, currentPrivs)
          return menuItem
        }
        return null
      } else {
        if (checkPermissions(menuItem.authority, currentPrivs)) {
          return menuItem
        }
        return null
      }
    })
    .filter((_: any) => _)
}

const formatMenuData = (toShowClients: any[], myClients: any[], currentPrivs: any[]) => {
  let staticList = [
    {
      name: '首页',
      path: '/home',
      /*icon: <HomeOutlined/>*/
    }
  ]
  let list: any[] = toShowClients.map((clientInfo: APPAPI.ClientPublic) => {
    return {
      name: clientInfo.clientName,
      path: `/sub/${clientInfo.clientCode}`
    }
  })
  return menuDataRender(staticList.concat(list), currentPrivs)
}

/**
 * @see  https://umijs.org/zh-CN/plugins/plugin-initial-state
 * */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: UCENTERAPI.UserInfoWithToken;
  loading?: boolean;
  fetchUserInfo?: () => Promise<UCENTERAPI.UserInfoWithToken | undefined>;
  menuData?: any[];
  toShowClients?: any[];
}> {
  const fetchUserInfo = async (redirect = true) => {
    try {
      const msg = await queryCurrentUser()
      return msg.data
    } catch (error) {
      if (redirect) {
        toLogin()
      }
    }
    return undefined
  }
  /*加载用户信息*/
  const currentUser = await fetchUserInfo(false)

  const fetchClients = async () => {
    try {
      return await getPCShowClients()
    } catch (error) {
      console.error(error)
    }
    return []
  }
  /*加载应用信息*/
  const toShowClients = await fetchClients()

  return {
    fetchUserInfo,
    currentUser,
    settings: defaultSettings as Partial<LayoutSettings>,
    toShowClients,
    menuData: formatMenuData(toShowClients, currentUser?.privs, currentUser?.privs),
  }
}

// ProLayout 支持的api https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({initialState, setInitialState}) => {
  return {
    actionsRender: () => [/*<Question key="doc" />, <SelectLang key="SelectLang" />*/],
    menu: {
      // 每当 initialState?.currentUser?.userid 发生修改时重新执行 request
      params: {
        userId: initialState?.menuData,
      },
      request: async (params, defaultMenuData) => {
        return initialState?.menuData || []
      },
      locale: false,
    },
    avatarProps: {
      src: initialState?.currentUser?.avatarUrl,
      title: <AvatarName/>,
      render: (_, avatarChildren) => {
        return <AvatarDropdown>{avatarChildren}</AvatarDropdown>
      },
    },
    waterMarkProps: {
      content: `${defaultSettings.title}${initialState?.currentUser?.realName ? '(' + initialState?.currentUser?.realName + ')' : ''}`,
      markStyle: {minHeight: 'calc(100vh - 250px)'}
    },
    contentStyle: {minHeight: 'calc(100vh - 64px)'},
    footerRender: () => <Footer/>,
    onPageChange: () => {
    },
    /*bgLayoutImgList: [
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
    ],*/
    links: isDev
      ? [
        <Link key='openapi' to='/umi/plugin/openapi' target='_blank'>
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
                }))
              }}
            />
          )}
        </>
      )
    },
    ...initialState?.settings,
    disableMobile: true,
    headerTitleRender: (logo, title, _) => {
      const defaultDom = (
        <a>
          {logo}
          {title}
        </a>
      )
      if (typeof window === 'undefined') return defaultDom
      if (_.isMobile) return defaultDom
      return (
        <>
          {defaultDom}
        </>
      )
    },
    headerRender: (_, defaultDom) => {
      return (
        <div style={{
          display: 'flex',
          height: '64px',
          alignItems: 'center'
        }}>
          <AppsMenuButton/>
          {defaultDom}
        </div>
      )
    }
  }
}

/**
 * @name request 配置，可以配置错误处理
 * 它基于 axios 和 ahooks 的 useRequest 提供了一套统一的网络请求和错误处理方案。
 * @doc https://umijs.org/docs/max/request#配置
 */
export const request = {
  ...errorConfig,
}
