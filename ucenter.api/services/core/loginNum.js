/**
 * @fileOverview 登录输错密码次数相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import redisClient from '../../daos/cache/redisClient.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const errorNumberPrefix = 'errorNumber:'
const errorStatusPrefix = 'errorStatus:'

/**
 * @description 创建统计信息次数，用于账户锁定
 * @author menglb
 * @param {Object} username 用户名
 * @param {Number} errorNumber 输入错误次数
 * @param {Number} [expiresTime] 过期时间，单位：秒
 * @returns {Object} 保存的用户和token信息对象
 */
export async function addErrorNumber(username, errorNumber, expiresTime) {
    if (!tools.isExist(username)) {
        throw new Error('缺少用户名')
    }
    if (!expiresTime) {
        expiresTime = config.userErrorNumberExpiresTime * 60
    }
    let _key = errorNumberPrefix + username
    let ret
    if (!errorNumber) {
        ret = await redisClient.addIncr(_key, expiresTime)
    } else if (errorNumber && errorNumber === 4) {
        await redisClient.addIncr(_key, 30 * 60)
        //增加限制信息
        let _key_status = errorStatusPrefix + username
        ret = await redisClient.setValue(_key_status, 1, 30 * 60)
    } else {
        ret = await redisClient.addIncr(_key)
    }
    return ret
}

/**
 * @description 获取错误数据统计信息
 * @author menglb
 * @param {String} username 用户名
 * @returns {Object} 保存的用户和token信息对象
 */
export async function getErrorNumber(username) {
    let _key = errorNumberPrefix + username
    return redisClient.getValue(_key)
}

/**
 * @description 删除错误信息
 * @author menglb
 * @param {String} username 用户名
 * @returns {Promise<Number>} 删除的行数
 */
export async function deleteErrorNumber(username) {
    let _key = errorNumberPrefix + username
    return redisClient.delValue(_key)
}

/**
 * @description 获取用户是否被锁定
 * @author menglb
 * @param {String} username 用户名
 * @returns {Object} 保存的用户和token信息对象
 */
export async function getErrorStatus(username) {
    let _key = errorStatusPrefix + username
    return redisClient.getValue(_key)
}