import * as _uuid from 'uuid'

export const base64Encode = (str: string) => {
    if (!str) {
        return str
    }

    return btoa(encodeURIComponent(str))
}

export const base64Decode = (str: string) => {
    if (!str) {
        return str
    }

    return decodeURIComponent(atob(str))
}

export const isNull = (obj: any) => {
    if (obj === null || obj === '' || obj === undefined || obj === 'undefined') {
        return true
    } else {
        return false
    }
}

export const waitTime = (time = 100) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(true)
        }, time)
    })
}

/**
 * @description 计算文本的HASH值
 */
export async function calcHashCode(text: string) {
    const encoder = new TextEncoder()
    const data = encoder.encode(text)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
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
 * @description uuid-timestamp
 * @returns {string}
 */
export const uuid = (): string => {
    return _uuid.v1().replace(/-/g, '')
}

/**
 * @description uuid-random
 * @returns {string}
 */
export const uuidV4 = (): string => {
    return _uuid.v4().replace(/-/g, '')
}
