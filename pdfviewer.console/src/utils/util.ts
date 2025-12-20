import * as _uuid from 'uuid'

export const base64Encode = (str: string) => {
  if (!str) {
    return str
  }
  return Buffer.from(str).toString('base64')
}

export const base64Decode = (str: string) => {
  if (!str) {
    return str
  }
  return Buffer.from(str, 'base64').toString('utf-8')
}

export const isNull = (obj: any) => {
  if (obj === null || obj === '' || obj === undefined || obj === 'undefined') {
    return true
  } else {
    return false
  }
}

/**
 * @description uuid-timestamp
 * @returns {*}
 */
export const uuid = () => {
  return _uuid.v1().replace(/-/g, '')
}

/**
 * @description uuid-random
 * @returns {string}
 */
export const uuidV4 = () => {
  return _uuid.v4().replace(/-/g, '')
}

/**
 * @description 等待时间函数
 */
export const waitTime = (time = 100) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true)
    }, time)
  })
}

/**
 * @description 拼接文件的访问地址
 */
export const getFileUrl = (fileInfo: any): string => {
  // @ts-ignore
  return `${DOC_API_BASE}/file/download/${fileInfo.fileName || ''}?fileCode=${fileInfo.fileCode}`
}

/**
 * @description 判断是否为数组
 * @param {Object} obj 输入对象
 * @return {Boolean} true or false
 */
export function isArray(obj: any) {
  return Array.isArray ? Array.isArray(obj) : Object.prototype.toString.call(obj) === '[object Array]'
}
