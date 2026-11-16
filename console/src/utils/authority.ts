import {base64Decode, base64Encode} from '@/utils/util'
import {delCache, getCache, setCache} from '@/utils/cache'
import _ from 'lodash'
import {getCookie, setCookie} from '@/utils/cookie'

const userCacheKey = 'uc'

export function checkPermissions(authority: boolean | string | string[], currentAuthority?: string[]) {
  if (!authority) {
    return true
  }
  if (currentAuthority?.includes('all')) {
    /*超级权限访问*/
    return true
  }
  if (Array.isArray(authority)) {
    if (authority.includes('all')) {
      return true
    }
    if (Array.isArray(currentAuthority)) {
      if (currentAuthority.some((item) => authority.includes(item))) {
        return true
      }
    } else if (currentAuthority && authority.includes(currentAuthority)) {
      return true
    }
    return false
  }
  if (typeof authority === 'string') {
    if (authority === 'all') {
      return true
    }
    if (Array.isArray(currentAuthority)) {
      if (currentAuthority.some((item) => authority === item)) {
        return true
      }
    } else if (authority === currentAuthority) {
      return true
    }
    return false
  }
  return false
}

export function setUserCache(userInfo: any) {
  let info = _.cloneDeep(userInfo)
  setCache(userCacheKey, base64Encode(JSON.stringify(info)))
}

export function getUserCache(json = true) {
  const str = getCache(userCacheKey)
  if (!str) {
    return undefined
  }
  if (!json) {
    return str
  }
  try {
    return JSON.parse(base64Decode(str))
  } catch (e) {
    return str
  }
}

export function getAccessToken() {
  const searchParams = new URLSearchParams(window.location.search)
  return searchParams.get('accessToken') || getCookie('param-accessToken') || ''
}

/**
 * 父域共享 cookie 多候选清除(2026-11-16 micro-platform 底座同步, 与 xxzx console/ucenter.console 同型):
 * 部署侧显式 cookieDomain 与"末两段"推导可能漂移, 单域删除空转致登出/换号后旧账号 token 滞留;
 * 对 末两段/剥首段 候选域幂等删两枚登录 cookie。父域 cookie 只由服务端 client-proxy 登录链权威下发。
 */
function clearSharedAuthCookies() {
  const parts = window.location.hostname.split('.');
  const candidates: string[] = [];
  if (parts.length >= 3 && /^[a-zA-Z]{2,}$/.test(parts[parts.length - 1])) {
    candidates.push('.' + parts.slice(-2).join('.'));
    if (parts.length >= 4) candidates.push('.' + parts.slice(1).join('.'));
  }
  for (const d of [...new Set(candidates)]) {
    try {
      document.cookie = 'param-accessToken=; path=/; domain=' + d + '; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      document.cookie = 'param-refreshToken=; path=/; domain=' + d + '; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    } catch {}
  }
}

export function toLogin() {
  fetch('/client-proxy/oauth/sign-out', {method: 'GET', credentials: 'include', keepalive: true}).catch(() => {});
  setCookie('param-accessToken', '', -1, '');
  clearSharedAuthCookies();
  delCache(userCacheKey)
  window.location.href = window.location.origin +
    '/client-proxy/oauth/logout?retUrl=' + encodeURIComponent(window.location.href)
}
