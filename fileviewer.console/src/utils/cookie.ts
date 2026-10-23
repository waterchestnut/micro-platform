export function setCookie(cookieName: string, cookieVal: string, expiresTime?: number, path?: string) {
  const d = new Date()
  d.setTime(d.getTime() + (expiresTime || 0) * 60 * 1000)
  const expires = 'expires=' + d.toUTCString()
  const pathStr = path ? 'path=' + path : 'path=/'
  document.cookie = cookieName + '=' + cookieVal + ';' + expires + ';' + pathStr
}

export function getCookie(cookieName: string): string {
  if (document.cookie.length > 0) {
    let cStart = document.cookie.indexOf(cookieName + '=')
    if (cStart !== -1) {
      cStart = cStart + cookieName.length + 1
      let cEnd = document.cookie.indexOf(';', cStart)
      if (cEnd === -1) cEnd = document.cookie.length
      let val = document.cookie.substring(cStart, cEnd)
      if (val) {
        val = decodeURIComponent(val)
      }
      return val
    }
  }
  return ''
}
