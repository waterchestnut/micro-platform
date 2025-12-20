// 腾讯无界微前端公共操作
// 无界说明文档：https://wujie-micro.github.io/doc/guide/variable.html

import {history} from "@@/core/history";
import {getAccessToken, getUserCache, toLogin} from "@/utils/authority";

/** 获取传递给子应用的功能Props */
export function getCommonProps(){
  return {
    jump: (name: string) => {
      history.push(`/${name}`);
    },
    getAccessToken: () => {
      return getAccessToken();
    },
    toLogin: () => {
      return toLogin();
    },
    getUserCache: (json = true) => {
      return getUserCache(json);
    }
  }
}
