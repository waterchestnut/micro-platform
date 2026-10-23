import { getCookie, setCookie } from '@/utils/cookie'
import { delCache, getCache, setCache } from '@/utils/cache'
import { getEmbeddedProps, isEmbedded } from '@/utils/embed'

const userCacheKey = 'uc'

export function getAccessToken(): string {
  if (isEmbedded()) {
    return (getEmbeddedProps() as any)?.getAccessToken?.() || ''
  }
  const searchParams = new URLSearchParams(window.location.search)
  return searchParams.get('accessToken') || getCookie('param-accessToken') || ''
}

export function getUserCache(json = true): any {
  if (isEmbedded()) {
    return (getEmbeddedProps() as any)?.getUserCache?.(json)
  }
  const str = getCache(userCacheKey)
  if (!str) return undefined
  if (!json) return str
  try {
    return JSON.parse(atob(str))
  } catch {
    return str
  }
}

export function setUserCache(userInfo: any) {
  const info = { ...userInfo }
  delete info.privs
  setCache(userCacheKey, btoa(JSON.stringify(info)))
}

export function toLogin() {
  if (isEmbedded()) {
    return (getEmbeddedProps() as any)?.toLogin?.()
  }
  setCookie('param-accessToken', '', -1, '')
  delCache(userCacheKey)
  window.location.href =
    '/client-proxy/oauth/logout?retUrl=' + encodeURIComponent(window.location.href)
}
