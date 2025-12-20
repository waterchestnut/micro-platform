/**
 * @fileOverview
 * @author xianyang
 * @module
 */

import * as uuid from 'uuid'

/**
 * @description 检测对象是否是一个function
 * @param {String} fn 函数名
 * @return {Boolean} true or false
 */
export function isFunction(fn) {
    return typeof fn === 'function'
}

/**
 * @description JSON字符串转化为对象
 * @param {String} str JSON字符串
 * @param {Boolean} [withFunc=false] 是否转换函数
 * @returns {Object} 转化后的对象
 * @function
 */
export function parseJSON(str, withFunc) {
    let obj = null
    try {
        if (!withFunc) {
            obj = JSON.parse(str)
        } else {
            obj = JSON.parse(str, function (key, value) {
                if (typeof value === 'string' &&
                    value.startsWith('function')) {
                    return eval('(' + value + ')')
                }
                return value
            })
        }
    } catch (e) {
    }
    return typeof obj === 'object' ? obj : null
}

/**
 * @description 判断是否为数组
 * @param {Object} obj 输入对象
 * @return {Boolean} true or false
 */
export function isArray(obj) {
    return Array.isArray ? Array.isArray(obj) : Object.prototype.toString.call(obj) === '[object Array]'
}

/**
 * @description 判断是否是字符串
 * @param {Object} str 输入对象
 * @return {Boolean} true or false
 */
export function isString(str) {
    return (typeof str === 'string') && str.constructor === String
}

/**
 * @description 判断是否为null
 * @param {Object} obj 输入对象
 * @return {Boolean} true or false
 */
export function isNull(obj) {
    return obj === null || obj !== obj
}

/**
 * @description 判断对象是否为空
 * @param {Object} obj 输入对象
 * @return {Boolean} true or false
 */
export function isEmpty(obj) {
    if (obj) {
        for (let key in obj) {
            return !hasOwn(obj, key)
        }
    }
    return true
}

/**
 * @description 转换成字符串
 * @param {Object} value 输入对象
 * @param {Boolean} [withFunc=false] 是否转换函数
 * @return {String} 转换后的字符串
 */
export function toStr(value, withFunc) {
    if (Object.prototype.toString.call(value) === '[object Null]') {
        return ''
    }
    if (typeof value === 'object') {
        if (!withFunc) {
            return JSON.stringify(value)
        }
        return JSON.stringify(value, function (key, value) {
            if (typeof value === 'function') {
                return value.toString()
            }
            return value
        })
    } else {
        return (value || value === 0) ? (value + '') : ''
    }
}

/**
 * @description 转换成Number
 * @param {Object} value 输入对象
 * @return {Number} 转换后的数字
 */
export function toNum(value) {
    if (isArray(value)) {
        value.forEach(function (x, i) {
            value[i] = +x || 0
        })
    } else {
        value = +value || 0
    }
    return value
}

/**
 * @description 转换成数组
 * @param {Object} value 输入对象
 * @return {Array} 转换后的数组
 */
export function toArray(value) {
    if (!isArray(value)) {
        value = value === undefined ? [] : [value]
    }
    return value
}

/**
 * @description 删除字符串两端的空格
 * @param {String} str 待处理字符串
 * @param {Boolean} strict 是否为严格模式，默认为false
 * @return {String} 删除空格后的字符串
 */
export function trim(str, strict) {
    return toStr(str).trim().replace(strict ? (/\s+/g) : (/ +/g), ' ').replace(/^\s+/, '').replace(/\s+$/, '')
}

/**
 * @description 判断独享是否存在该属性
 * @param {Object} obj 输入对象
 * @param {String} key 属性名
 * @return {Boolean} true or false
 */
export function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key)
}

/**
 * @description 判断对象是否存在，undefined、null、''都是不存在
 * @param {Object} obj 输入对象
 * @return {Boolean} true or false
 */
export function isExist(obj) {
    return !(typeof (obj) === 'undefined' || obj === null || obj === '')
}

/**
 * @description 判断对象是否未定义
 * @param {Object} obj 输入对象
 * @return {Boolean} true or false
 */
export function isUndefined(obj) {
    return typeof (obj) === 'undefined'
}

/**
 * @description 为目标数字左侧补零，并输出补零后数字字符串
 * @param {Number} num 目标数字
 * @param {Number} n 数字格式位数
 * @return {String} 补零后的数字字符串
 */
export function pad(num, n) {
    let len = num.toString().length
    while (len < n) {
        num = '0' + num
        len++
    }
    return num
}

/**
 * @description 生成uuid
 * @return {String} uuid
 */
export function getUUID() {
    return uuid.v1().replace(/-/g, '')
}

/**
 * @description 根据字段值获取字段key值，主要用于枚举类获取描述信息
 * @param {Object} obj 枚举对象
 * @param {Object} val 枚举值
 * @return {String} 键值
 */
export function getKeyByVal(obj, val) {
    if (!obj) {
        return ''
    }
    for (let i in obj) {
        if (obj[i] === val) {
            return i
        }
    }

    return ''
}

/**
 * @description 获取文件的扩展名
 * @param {String} fileName 文件名
 * @return {String} 文件扩展名
 */
export function getFileExt(fileName) {
    let fileTypeMatches = fileName.match(/.([^.]*)$/)
    let fileFormat = ''
    if (fileTypeMatches && fileTypeMatches.length > 1) {
        fileFormat = fileTypeMatches[1]
    }

    return fileFormat
}

/**
 * @description 截字
 * @param {String} str 要截字的字符串
 * @param {Number} num 截字字节数目
 * @param {String} [appendChars] 超长时尾部附件的字符串
 * @returns {String} 截字后的字符串
 */
export function substring(str, num, appendChars) {
    if (!str || !num) {
        return ''
    }
    if (str.length <= num) {
        return str
    }
    let strReturn = ''
    num *= 2
    let a = 0
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 255) {
            a += 2
        } else {
            a++
        }
        if (a > num) {
            break
        }
        strReturn += str.charAt(i)
    }

    if (str.length <= strReturn.length || (typeof appendChars !== 'undefined' && !appendChars)) {
        return strReturn
    }
    if (typeof appendChars === 'undefined') {
        appendChars = '...'
    }
    return strReturn + appendChars
}

/**
 * @description 取字符串的整型hash值
 * @param {String} str 要处理的字符串
 * @returns {Number} hash值
 */
export function hashCode(str) {
    let hash = 0
    if (str.length === 0) return hash
    for (let i = 0; i < str.length; i++) {
        let char = str.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        /* Convert to 32bit integer */
        hash = hash & hash
    }
    return Math.abs(hash)
}

/**
 * @description 判定给定的数据是否为对象
 * @param {Object} obj 给定的数据
 * @returns {Boolean} 是否为对象
 */
export function isObject(obj) {
    return Object.prototype.toString.call(obj) === '[object Object]'
}

/**
 * @description 延迟毫秒数
 * @param {Number} time 毫秒数
 * @return {Promise<Boolean>}
 */
export function waitTime(time = 100) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true)
        }, time)
    })
}

/**
 * @description 判定域名是否允许跨域
 * @param {String} origin 当前访问者域名
 * @param {Array|String} allowedOrigin 配置允许的域名
 * @return {Boolean}
 */
export function isOriginAllowed(origin, allowedOrigin) {
    if (isArray(allowedOrigin)) {
        for (let i = 0; i < allowedOrigin.length; i++) {
            if (isOriginAllowed(origin, allowedOrigin[i])) {
                return true
            }
        }
        return false
    } else if (isString(allowedOrigin)) {
        return origin === allowedOrigin
    } else if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin)
    } else {
        return !!allowedOrigin
    }
}

/**
 * @description 深度复制对象
 * @param {Object} obj 要复制的对象
 * @return {Object} 复制的新对象
 */
export function cloneDeep(obj) {
    if (!obj) {
        return obj
    }
    return JSON.parse(JSON.stringify(obj))
}