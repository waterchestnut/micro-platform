/**
 * @fileOverview
 * @author xianyang
 * @module
 */

export function getCookieValue(req, name) {
    if (!req || !req.headers || !req.headers.cookie) {
        return null
    }

    let cookieString = req.headers.cookie
    let pairs = cookieString.split(/[,] */)
    let cookies = {}
    for (let i = 0; i < pairs.length; i++) {
        let idx = pairs[i].indexOf('=')
        let key = pairs[i].substr(0, idx).toLocaleLowerCase()
        let val = pairs[i].substr(++idx, pairs[i].length).trim()
        cookies[key] = val
    }
    name = name.toLocaleLowerCase()
    if (cookies[name]) {
        return cookies[name]
    } else {
        return null
    }
}