/**
 * 设置cookie
 * @param {String} cookieName cookie的name
 * @param {String} cookieVal cookie的value
 * @param {Number} [expiresTime] cookie的过期时间（单位：分钟）
 * @param {String} [path] cookie路径
 */
export function setCookie(cookieName: string, cookieVal: string, expiresTime?: number, path?: string) {
  let d = new Date();
  // @ts-ignore
  d.setTime(d.getTime() + expiresTime * 60 * 1000);
  let expires = 'expires=' + d.toUTCString();
  let pathStr = path ? 'path=' + path : 'path=/';

  document.cookie = cookieName + '=' + cookieVal + ';' + expires + ';' + pathStr;
}

/**
 * 获取cookie
 * @param {String} cookieName cookie的name
 * @return {String} cookie的value
 */
export function getCookie(cookieName: string): string {
  if (document.cookie.length > 0) {
    let cStart = document.cookie.indexOf(cookieName + '=');
    if (cStart !== -1) {
      cStart = cStart + cookieName.length + 1;
      let cEnd = document.cookie.indexOf(';', cStart);
      if (cEnd === -1) cEnd = document.cookie.length;
      let val = document.cookie.substring(cStart, cEnd);
      if (val) {
        val = decodeURIComponent(val);
      }
      return val;
    }
  }
  return '';
}
