/**
 * @fileOverview 请求地址栏参数相关的操作
 * @module tools/queryString
 */

import urlM, {URL} from 'url'
import qsM from 'querystring'

/**
 * 把对象拼接为get参数字符串
 * @param {Object} obj 对象参数
 * @param {String} [keyParam] 键值参数
 * @return {String} 参数字符串
 */
export function getQueryString(obj, keyParam) {
    if (!obj || typeof obj !== 'object') {
        return ''
    }
    if (!keyParam && obj instanceof Array) {
        return ''
    }
    if (obj instanceof Array) {
        let tempParams = []
        obj.forEach(item => {
            if (typeof item === 'object') {
                tempParams.push(getQueryString(item, keyParam))
            } else {
                tempParams.push(keyParam + '=' + encodeURIComponent(item))
            }
        })
        return tempParams.join('&').replace(/%20/g, '+')
    }
    return Object.keys(obj)
        .map((key) => {
            let keyStr = encodeURIComponent(key)
            if (keyParam) {
                keyStr = keyParam + '[' + keyStr + ']'
            }

            if (typeof obj[key] === 'object') {
                return getQueryString(obj[key], keyStr)
            } else {
                obj[key] = obj[key] + ''
            }

            return keyStr + '=' + encodeURIComponent(obj[key] || '')
        })
        .join('&')
        .replace(/%20/g, '+')
}

/**
 * @description 获取url中的参数
 * @param {String} url url
 * @param {String} key 参数名
 * @return {String} 参数值
 */
export function getUrlParam(url, key) {
    const urlObj = new URL(url)
    return urlObj.searchParams.get(key)
}

/**
 * @description querystring字符串解析为对象
 * @param {String} querystring querystring字符串
 * @return {Object} JSON对象
 */
export function querystringToObj(querystring) {
    if (!querystring || !querystring.indexOf('=') < 0) {
        return {}
    }

    let objString = JSON.stringify(qsM.parse(querystring))
    return JSON.parse(objString)
}

/**
 * @description 往url中添加参数
 * @param {String} url url
 * @param {String} key 参数名
 * @param {String} value 参数值
 * @return {String} url
 */
export function setUrlParam(url, key, value) {
    const urlObj = new URL(url)
    urlObj.searchParams.set(key, value)
    return urlObj.toString()
}

/**
 * @description 往url中添加参数
 * @param {String} url url
 * @param {Object} keyValues 要添加的参数，格式为{key:value}
 * @return {String} url
 */
export function setUrlParams(url, keyValues) {
    const urlObj = new URL(url)
    for (let key in keyValues) {
        urlObj.searchParams.set(key, keyValues[key])
    }
    return urlObj.toString()
}
