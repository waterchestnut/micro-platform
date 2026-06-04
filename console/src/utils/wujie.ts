// 腾讯无界微前端公共操作
// 无界说明文档：https://wujie-micro.github.io/doc/guide/variable.html

import {history} from '@@/core/history'
import {getAccessToken, getUserCache, toLogin} from '@/utils/authority'

//@ts-ignore
const platformBaseUrl = PLATFORM_BASE

/** 获取传递给子应用的功能Props */
export function getCommonProps() {
  return {
    jump: (name: string) => {
      location.href = name
    },
    getAccessToken: () => {
      return getAccessToken()
    },
    toLogin: () => {
      return toLogin()
    },
    getUserCache: (json = true) => {
      return getUserCache(json)
    },
    toClient: (clientCode: string, path: string) => {
      history.push(`/sub/${clientCode}?${clientCode}=${encodeURIComponent(path)}`)
    },
    getToClientUrl: (clientCode: string, path: string) => {
      return `${platformBaseUrl}/sub/${clientCode}?${clientCode}=${encodeURIComponent(path)}`
    },
    platformBaseUrl: platformBaseUrl,
  }
}

/** 获取通用的无界插件 */
export function getCommonPlugins() {
  return [
    {
      windowPropertyOverride: (subWindow: typeof window) =>
        Object.defineProperty(subWindow.Navigator.prototype, 'clipboard', {
          get: () => {
            // @ts-ignore
            return subWindow.__POWERED_BY_WUJIE__ ? subWindow.parent.navigator.clipboard : subWindow.navigator.clipboard
          },
        }),
    },
  ]
}
