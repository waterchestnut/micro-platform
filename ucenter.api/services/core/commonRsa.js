/**
 * @fileOverview 站内通用Rsa加解密
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import * as fs from 'node:fs'
import {rsaDecrypt, rsaEncrypt} from "../../tools/security.js"
import crypto from 'crypto'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description rsa公钥加密
 * @author menglb
 * @param {String} publicStr 明文
 * @returns {String} 加密后的字符串
 */
export function encrypt(publicStr) {
    try {
        const publicKey = fs.readFileSync(ucenter.baseDir + 'conf/public_key.pem', {encoding: 'utf8'})
        return rsaEncrypt(publicStr, publicKey)
    } catch (err) {
        logger.error('rsa加密出错:')
        logger.error(err)
        logger.info('明文: ' + publicStr)
        throw new Error('未知错误，请重试')
    }
}

/**
 * @description rsa私钥解密
 * @author menglb
 * @param {String} privateStr 密文
 * @returns {String} 解密后的字符串
 */
export function decrypt(privateStr) {
    try {
        const privateKey = fs.readFileSync(ucenter.baseDir + 'conf/private_key.pem', {encoding: 'utf8'})
        return rsaDecrypt(privateStr, privateKey)
    } catch (err) {
        logger.error('rsa解密出错:')
        logger.error(err)
        logger.info('密文: ' + privateStr)
        throw new Error('未知错误，请重试')
    }
}

/**
 * @description 跟新秘钥对
 */
export function genKeyPair() {
    const {publicKey, privateKey} = crypto.generateKeyPairSync("rsa", {
        // The standard secure default length for RSA keys is 2048 bits
        modulusLength: 2048,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem',
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
        },
    })
    fs.writeFileSync(ucenter.baseDir + 'conf/private_key.pem', privateKey)
    fs.writeFileSync(ucenter.baseDir + 'conf/public_key.pem', publicKey)
    return publicKey;
}