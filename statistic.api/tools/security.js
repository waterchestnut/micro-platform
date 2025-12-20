/**
 * @fileOverview 安全相关的工具方法集合
 * @module tools/security
 */

import crypto from 'crypto'

/**
 * @description aes的对称加密
 * @param {String} str 待加密的字符串
 * @param {String} sKey 加密密钥
 * @param {String} algorithm 加密模式
 * @param {String} iv 偏移量
 * @returns {String} 加密后的字符串
 */
export function encrypt(str, sKey, algorithm = 'aes-128-ecb', iv = '') {
    let cipher = crypto.createCipheriv(algorithm, sKey, iv)
    cipher.setAutoPadding(true)
    let enc = cipher.update(str, 'utf8', 'hex')
    enc += cipher.final('hex')
    return enc
}

/**
 * @description aes的对称解密
 * @param {String} str 待解密的字符串
 * @param {String} sKey 解密密钥
 * @param {String} algorithm 加密模式
 * @param {String} iv 偏移量
 * @returns {String} 解密后的字符串
 */
export function decrypt(str, sKey, algorithm = 'aes-128-ecb', iv = '') {
    let decipher = crypto.createDecipheriv(algorithm, sKey, iv)
    let dec = decipher.update(str, 'hex', 'utf8')
    dec += decipher.final('utf8')
    return dec
}

/**
 * @description md5编码
 * @param {String} str 待编码的字符串
 * @returns {String} md5编码后的字符串
 */
export function md5(str) {
    let md5Sum = crypto.createHash('md5')
    md5Sum.update(str)
    str = md5Sum.digest('hex')
    return str
}

/**
 * @description base64编码
 * @param {String} str 待编码的字符串
 * @returns {String} base64编码后的字符串
 */
export function base64Encode(str) {
    if (!str) {
        return str
    }
    return Buffer.from(str).toString('base64')
}

/**
 * @description base64解码
 * @param {String} str 待解码的字符串
 * @returns {String} base64解码后的字符串
 */
export function base64Decode(str) {
    if (!str) {
        return str
    }
    return Buffer.from(str, 'base64').toString('utf-8')
}

/**
 * @description SQL字符串过滤
 * @param {String} str 待过滤的字符串
 * @returns {String} 过滤后的字符串
 */
export function sqlEncode(str) {
    if (!str) {
        return str
    }
    str = str.replaceAll(/[^0-9a-zA-Z-_.]+(select|update|and|or|delete|insert|truncate|substr|ascii|exec|count|master|into|drop|execute|table|char|declare|sitename|xp_cmdshell|like|from|grant|use|group_concat|column_name|information_schema\.columns|table_schema|union|where|order|by)[^0-9a-zA-Z-_.]+/ig, '').replaceAll(/"|'||--|\+|,|\/\/|%|#/ig, '')
    return str
}

/**
 * @description rsa加密
 * @param {String} publicStr 明文
 * @param {String} key 秘钥
 * @returns {string|Buffer} 加密后的字符串
 */
export function rsaEncrypt(publicStr, key) {
    const encrypted = crypto.publicEncrypt(
        {key,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING}, Buffer.from(publicStr))
    return encrypted.toString("base64")
}

/**
 * @description rsa解密
 * @param {string|Buffer} privateStr 密文
 * @param {String} key 秘钥
 * @returns {String} 解密后的字符串
 */
export function rsaDecrypt(privateStr, key) {
    const decrypted = crypto.privateDecrypt(
        {key,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING}, Buffer.from(privateStr, "base64"))
    return decrypted.toString()
}

/**
 * @description sha1编码
 * @param {String} str 待编码的字符串
 * @returns {String} sha1编码后的字符串
 */
export function sha1(str) {
    let sha1Sum = crypto.createHash('sha1')
    sha1Sum.update(str)
    str = sha1Sum.digest('hex')
    return str
}