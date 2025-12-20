/**
 * @fileOverview 用户相关的格式化等操作
 * @author xianyang
 * @module
 */

import userInfoDac from '../../daos/core/dac/userInfoDac.js'
import retSchema from '../../daos/retSchema.js'
import * as security from '../../tools/security.js'
import * as rsaLogic from './commonRsa.js'
import {addAccessToken} from "./accessToken.js";
import {addRefreshToken} from "./refreshToken.js";
import {deleteErrorNumber} from "./loginNum.js";

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 通用用户信息格式化
 * @author xianyang
 * @param {Array} userList 待格式化的用户列表
 * @returns {Promise<Array>} 格式化后的用户列表
 */
export async function formatUserList(userList) {
    if (!userList || !userList.length) {
        return userList
    }

    userList = userList.map(user => {
        for (let key in user) {
            tools.isNull(user[key]) && (delete user[key])
        }
        delete user.pwd
        delete user.insertTime
        delete user._id
        return user
    })
    return userList
}

/**
 * @description 删除用户信息中的大字段数据
 * @author xianyang
 * @param {Object} user 待处理的用户
 * @returns {Object} 处理后的用户
 */
export function deleteBigField(user) {
    if (!user) {
        return user
    }

    let userInfo = {...user}

    delete userInfo._id
    delete userInfo.pwd
    delete userInfo.insertTime
    delete userInfo.phoneList
    delete userInfo.mobileList
    delete userInfo.emailList

    return userInfo
}

/**
 * @description 删除用户私密信息，只保留公开信息
 * @author xianyang
 * @param {Array} userInfos 用户列表
 * @returns {Promise<Array>} 只保留公开信息的用户列表
 */
export async function formatPublicUserInfo(userInfos) {
    if (!userInfos || !userInfos.length) {
        return userInfos
    }
    let newUserInfos = []
    userInfos.forEach(user => {
        newUserInfos.push({
            userCode: user.userCode,
            realName: user.realName,
            nickName: user.nickName,
            avatarUrl: user.avatarUrl
        })
    })

    return newUserInfos
}

/**
 * @description 获取用户的md5密码
 * @author menglb
 * @param {Object} userInfo 用户对象
 * @param {String} userInfo.pwd 密码原文
 * @param {Date} userInfo.insertTime 用户生成时间
 * @returns {String} md5密码
 */
export function getMd5Pwd(userInfo) {
    return security.md5(userInfo.insertTime.getUTCFullYear() + userInfo.pwd + userInfo.insertTime.getUTCMonth())
}

/**
 * @description 生成用户model
 * @author menglb
 * @param {Object} user 用户信息参数
 * @param {Number} encrypt 密码是否加密
 * @param {Boolean} isCheckPwd 是否检验密码
 * @returns {Object} 用户model
 */
export function generateUserModel(user, encrypt, isCheckPwd = false) {
    let time = new Date()
    let model = {
        userCode: user.userCode,
        loginName: user.loginName,
        pwd: user.pwd,
        mobile: user.mobile,
        email: user.email,
        mobileList: user.mobileList,
        phoneList: user.phoneList,
        emailList: user.emailList,
        nickName: user.nickName || '',
        realName: user.realName || '',
        avatarUrl: user.avatarUrl || '',
        office: user.office,
        nation: user.nation,
        politics: user.politics,
        birthday: user.birthday,
        orderNum: user.orderNum,
        degree: user.degree,
        gender: user.gender,
        authType: user.authType,
        schemaCodes: user.schemaCodes,
        orgCodes: user.orgCodes,
        tags: user.tags,
        modulePrivCodes: user.modulePrivCodes,
        groupCodes: user.groupCodes,
        departments: user.departments,
        mainJobCode: user.mainJobCode,
        updateTime: user.updateTime || time,
        status: 0,
        insertTime: time
    }
    /*传输的密文解密*/
    if (encrypt) {
        model.pwd = rsaLogic.decrypt(user.pwd)
    }
    if (isCheckPwd) {
        checkPassword(model.pwd)
    }
    model.pwd = getMd5Pwd(model)
    return model
}

/**
 * @description 校验密码复杂度
 * @author menglb
 * @param {String} password 密码原文
 * @param {Object} userPwdRuleConfig 密码复杂度要求的配置
 * @returns {Object} 校验结果
 */
function checkPasswordComplexity(password, userPwdRuleConfig) {
    let regx = {
        lengthRegex: /^.{8,32}$/,
        numRegex: /[0-9]/,
        lcaseRegex: /[a-z]/,
        ucaseRegex: /[A-Z]/,
        specialRegex: /[^A-Za-z0-9\s]/,
        invalidRegex: /[\u4e00-\u9fa5\s]/ig
    }
    regx.lengthRegex = new RegExp('^.{' + userPwdRuleConfig.minLength + ',' + userPwdRuleConfig.maxLength + '}$')
    regx.invalidRegex = new RegExp(userPwdRuleConfig.invalidRegex, 'ig')
    let needRegex = userPwdRuleConfig.needRegex
    for (let key in needRegex) {
        regx[key] = new RegExp(needRegex[key])
    }
    let res = {}
    let level = 0
    for (let key in regx) {
        res[key] = regx[key].test(password)
        if (key !== 'lengthRegex' && key !== 'invalidRegex' && res[key]) {
            level += 1
        }
    }
    res.requiredIsValid = true
    if (Object.keys(userPwdRuleConfig.requiredRegex).length > 0) {
        for (let key in userPwdRuleConfig.requiredRegex) {
            if (!res[key]) {
                res.requiredIsValid = false
                break
            }
        }
    }
    res.level = level
    return res
}

/**
 * @description 校验密码是否合规（无返回结果，不合规抛出错误异常）
 * @author menglb
 * @param {String} pwd 密码原文
 */
export function checkPassword(pwd) {
    let checkRet = checkPasswordComplexity(pwd, config.userPwdRuleConfig)
    if (!checkRet.lengthRegex) {
        /*密码长度不在指定范围*/
        throw new Error('密码长度不正确')
    }
    if (checkRet.invalidRegex) {
        /*密码有非法字符-中文-空格*/
        throw new Error('密码含有非法字符')
    }
    if (checkRet.level < config.userPwdRuleConfig.minRequireLevel) {
        /*密码复杂度不够*/
        throw new Error('密码强度弱，建议修改')
    }
    if (!checkRet.requiredIsValid) {
        /*密码没有包含必要的字符，不符合规则*/
        throw new Error('密码不符合包含规则')
    }
}

/**
 * @description 附加用户详细信息，并生产token数据
 * @author menglb
 * @param {Object} userInfo 用户基本信息对象
 * @param {Boolean} [genRefreshToken=true] 是否生成refreshToken
 * @param {Object} [extInfo={}] token中存储的扩展信息
 * @param {String} [username] 用户登录时输入的用户名
 * @returns {Object} 附带详细信息和token的用户对象
 */
export async function generateToken(userInfo, genRefreshToken = true, extInfo = {}, username) {
    /*待返回用户信息*/
    let userDetail = deleteBigField(userInfo);

    /*生成accessToken*/
    let accessTokenInfo = await addAccessToken(userInfo.userCode, undefined, extInfo);
    userDetail.accessToken = accessTokenInfo.accessToken;
    userDetail.expiresTime = accessTokenInfo.expiresTime;
    /*生成refreshToken*/
    if (genRefreshToken) {
        extInfo.accessToken = accessTokenInfo.accessToken;
        let refreshTokenInfo = await addRefreshToken(userInfo.userCode, undefined, extInfo);
        userDetail.refreshToken = refreshTokenInfo.refreshToken;
    }

    await deleteErrorNumber(username || userInfo.userCode);

    return userDetail;
}