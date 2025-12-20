import {base64Decode, base64Encode} from "@/utils/util";
import {delCache, getCache, setCache} from "@/utils/cache";
import _ from "lodash";
import {getCookie, setCookie} from "@/utils/cookie";
import {getEmbeddedProps, isEmbedded} from "@/utils/embed";

const userCacheKey = 'uc';

export function checkPermissions(authority: boolean | string | string[], currentAuthority?: string[]) {
  if (!authority) {
    return true;
  }
  if (Array.isArray(authority)) {
    if (authority.includes('all')) {
      return true;
    }
    if (Array.isArray(currentAuthority)) {
      if (currentAuthority.some((item) => authority.includes(item))) {
        return true;
      }
    } else if (currentAuthority && authority.includes(currentAuthority)) {
      return true;
    }
    return false;
  }
  if (typeof authority === 'string') {
    if (authority === 'all') {
      return true;
    }
    if (Array.isArray(currentAuthority)) {
      if (currentAuthority.some((item) => authority === item)) {
        return true;
      }
    } else if (authority === currentAuthority) {
      return true;
    }
    return false;
  }
  return false;
}

export function setUserCache(userInfo: any) {
  let info = _.cloneDeep(userInfo);
  delete info.privs;
  setCache(userCacheKey, base64Encode(JSON.stringify(info)));
}

export function getUserCache(json = true) {
  if (isEmbedded()) {
    return getEmbeddedProps()?.getUserCache(json);
  }

  const str = getCache(userCacheKey);
  if (!str) {
    return undefined;
  }
  if (!json) {
    return str;
  }
  try {
    return JSON.parse(base64Decode(str));
  } catch (e) {
    return str;
  }
}

export function getAccessToken() {
  if (isEmbedded()) {
    return getEmbeddedProps()?.getAccessToken();
  }
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get('accessToken') || getCookie('param-accessToken') || '';
}

export function toLogin() {
  if (isEmbedded()) {
    return getEmbeddedProps()?.toLogin();
  }

  setCookie('param-accessToken', '', -1, '');
  delCache(userCacheKey);
  window.location.href =
    '/client-proxy/oauth/logout?retUrl=' + encodeURIComponent(window.location.href);
}
