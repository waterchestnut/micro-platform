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

export const waitTime = (time = 100) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true)
    }, time)
  })
}

/**
 * @description 拼接文件服务的绝对地址
 */
export const getDocHttpUrl = (relativeUrl: string): string => {
  if (relativeUrl.startsWith('http')) {
    return relativeUrl
  }
  // @ts-ignore
  return `${DOC_API_BASE}${relativeUrl.startsWith('/') ? '' : '/'}${relativeUrl}`
}

/**
 * @description 拼接文件的下载地址
 * @param {String} fileCode 文件标识
 * @param {String} [fileName=''] 文件名
 * @returns {String} 文件下载地址
 */
export function getDownloadUrl(fileCode: string, fileName: string = ''): string {
  if (isNull(fileCode)) {
    return ''
  }
  return `/file/download/${fileName}?fileCode=${fileCode}`
}

/**
 * @description 格式化antd上传文件的对象
 * @param {Object[]} files 源文件列表
 * @returns {Object[]} 格式化后的文件列表
 */
export const formatUploadFile = (files: any[] = []): any[] => {
  let list: any[] = []
  files.forEach(file => {
    let fileCode = file.fileCode || file.response?.data?.fileCode
    if (file.url) {
      // @ts-ignore
      file.url = file.url.replace(`${DOC_API_BASE}`, '')
    }
    list.push({
      uid: file.uid,
      lastModified: file.lastModified,
      lastModifiedDate: file.lastModifiedDate,
      name: file.name || file.response?.data?.fileName,
      size: file.size,
      type: file.type,
      percent: file.percent,
      status: file.status,
      fileCode,
      fileHashCode: file.fileHashCode || file.response?.data?.fileHashCode,
      fileExt: file.fileExt || file.response?.data?.fileExt,
      url: file.url || getDownloadUrl(fileCode, file.name || file.response?.data?.fileName)
    })
  })
  return list
}
