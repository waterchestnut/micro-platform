/**
 * @fileOverview 用户相关的业务操作
 * @author xianyang
 * @module
 */

import userInfoDac from '../../daos/core/dac/userInfoDac.js'
import groupDac from '../../daos/core/dac/groupDac.js'
import retSchema from '../../daos/retSchema.js'
import { checkPassword, formatPublicUserInfo, formatUserList, generateUserModel, getMd5Pwd } from "./userUtils.js"
import { checkOrgStatus } from "./orgInfo.js"
import * as rsaLogic from "./commonRsa.js"

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 获取用户的详细信息
 * @author xianyang
 * @param {String} userCode 用户标识
 * @returns {Promise<Object>} 用户详细信息
 */
export async function getUserDetail(userCode) {
    return userInfoDac.getByCode(userCode)
}


/**
 * @description 通过姓名、手机号或学号获取用户信息
 * @param {String} info 用户标识
 * @returns {Promise<Object>} 用户详细信息
 */
export async function getUserByInfo(info) {

    let options = {
        complexFilter: {
            $or: [
                { realName: { $regex: info, $options: 'i' } },
                { mobile:  { $regex: info, $options: 'i' } },
                { userCode: { $regex: info, $options: 'i' } }
            ],
            groupCodes: { $in: ['student'] }  // 新增的筛选条件
        }
    };

    console.log(options)

    let data=userInfoDac.getTop(1000, options);
    return data
}

/**
 * @description 获取用户列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 机构数组}
 */
export async function getUserList(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }

    let ret = await userInfoDac.getByPage(pageIndex, pageSize, optionsIn)
    ret.rows = await formatUserList(ret.rows)

    /* 处理返回信息 */
    if (options.onlyPublic) {
        ret.rows = await formatPublicUserInfo(ret.rows)
    }

    return ret
}

/**
 * @description 添加用户
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {Object} userInfo 用户对象
 * @param {String} schemaCode 使用模式
 * @param {Boolean} [isCheckPwd=true] 是否校验密码
 * @returns {Object} 添加成功时返回新添加的用户对象
 */
export async function addUserInfo(curUserInfo, userInfo, schemaCode = '', isCheckPwd = true) {
    if (!userInfo) {
        throw new Error('未传递用户数据')
    }
    if (!userInfo.userCode || !userInfo.pwd) {
        throw new Error('需要用户标识、密码')
    }
    // 验证用户标识
    let oldUser = await userInfoDac.getOneByFilter({userCode: userInfo.userCode})
    if (oldUser) {
        /*用户已存在*/
        let err = Object.assign({data: userInfo.userCode}, retSchema.FAIL_USER_HASEXIST_USERCODE, {msg: '用户标识已存在'})
        return err
    }
    // 验证手机号
    if (userInfo.mobile?.length) {
        userInfo.mobile = userInfo.mobile.trim()
        let filter = {mobile: userInfo.mobile}
        schemaCode && (filter.schemaCodes = schemaCode)
        oldUser = await userInfoDac.getOneByFilter(filter)
        if (oldUser) {
            /*手机号已存在*/
            let err = Object.assign({data: oldUser.userCode}, retSchema.FAIL_USER_HASEXIST_MOBILE, {msg: '手机号已存在'})
            return err
        }
    }
    // 验证邮箱
    if (userInfo.email?.length) {
        userInfo.email = userInfo.email.trim()
        let filter = {email: userInfo.email}
        schemaCode && (filter.schemaCodes = schemaCode)
        oldUser = await userInfoDac.getOneByFilter(filter)
        if (oldUser) {
            /*邮箱已存在*/
            let err = Object.assign({data: oldUser.userCode}, retSchema.FAIL_USER_HASEXIST_EMAIL, {msg: '邮箱已存在'})
            return err
        }
    }
    // 验证机构状态
    if (userInfo.orgCodes) {
        for (let i = 0; i < userInfo.orgCodes.length; i++) {
            await checkOrgStatus(userInfo.orgCodes[i])
        }
    }
    // 添加用户
    let user = generateUserModel(userInfo, userInfo.encrypt, isCheckPwd)
    let ret = await userInfoDac.add(user)
    if (!ret?.userCode) {
        let err = Object.assign({data: userInfo.userCode}, retSchema.FAIL_UNEXPECTED)
        err.msg = '用户添加失败'
        return err
    }
    return ret
}

/**
 * @description 修改用户
 * @author menglb
 * @param {String} userCode 用户标识
 * @param {Object} newUser 新的用户对象
 * @param {Number} isDelToken 0保留token，1或空为删除token
 * @param {String} schemaCode 使用模式
 * @returns {Object} 受影响的行数
 */
export async function updateUserInfo(userCode, newUser, isDelToken = 1, schemaCode = '') {
    if (!userCode) {
        throw new Error('缺少用户标识')
    }
    if (!newUser) {
        throw new Error('没有要更新的数据')
    }

    let userInfo = await userInfoDac.getOneByFilter({userCode})
    if (!userInfo) {
        /*用户不存在*/
        throw new Error('用户不存在')
    }

    if (newUser.mobile && newUser.mobile !== userInfo.mobile) {
        newUser.mobile = newUser.mobile.trim()
        let filter = {mobile: newUser.mobile}
        schemaCode && (filter.schemaCodes = schemaCode)
        let tmpUser = await userInfoDac.getOneByFilter(filter)
        if (tmpUser) {
            /*手机号已存在*/
            throw new Error('手机号已存在')
        }
    }
    if (newUser.email && newUser.email !== userInfo.email) {
        newUser.email = newUser.email.trim()
        let filter = {email: newUser.email}
        schemaCode && (filter.schemaCodes = schemaCode)
        let tmpUser = await userInfoDac.getOneByFilter(filter)
        if (tmpUser) {
            /*邮箱已存在*/
            throw new Error('邮箱已存在')
        }
    }

    let user = {
        userCode,
        mobile: newUser.mobile,
        email: newUser.email,
        mobileList: newUser.mobileList,
        phoneList: newUser.phoneList,
        emailList: newUser.emailList,
        nickName: newUser.nickName || '',
        realName: newUser.realName || '',
        avatarUrl: newUser.avatarUrl || '',
        office: newUser.office,
        nation: newUser.nation,
        politics: newUser.politics,
        birthday: newUser.birthday,
        orderNum: newUser.orderNum,
        degree: newUser.degree,
        gender: newUser.gender,
        schemaCodes: newUser.schemaCodes,
        orgCodes: newUser.orgCodes,
        tags: newUser.tags,
        modulePrivCodes: newUser.modulePrivCodes,
        groupCodes: newUser.groupCodes,
        departments: newUser.departments,
        mainJobCode: newUser.mainJobCode,
    }

    if (newUser.pwd) {
        /*传输的密文解密*/
        if (newUser.encrypt) {
            newUser.pwd = rsaLogic.decrypt(newUser.pwd)
        }
        checkPassword(newUser.pwd)
        user.pwd = getMd5Pwd({pwd: newUser.pwd, insertTime: userInfo.insertTime})
    }

    // 验证机构状态
    if (newUser.orgCodes) {
        for (let i = 0; i < newUser.orgCodes.length; i++) {
            await checkOrgStatus(newUser.orgCodes[i])
        }
    }

    return userInfoDac.update(user)
}

/**
 * @description 删除用户(逻辑删除)
 * @author menglb
 * @param {String} userCode 用户标识
 * @returns {Object} 受影响的行数
 */
export async function deleteUserInfo(userCode) {
    if (!userCode) {
        throw new Error('缺少用户标识')
    }

    let user = {
        userCode,
        status: -1
    };

    return userInfoDac.update(user)
}

/**
 * @description 获取用户的权限列表
 * @author menglb
 * @param {String} userCode 用户标识
 * @returns {Promise<Array>} 权限标识列表
 */
export async function getUserPrivs(userCode) {
    let userInfo = await userInfoDac.getByCode(userCode)
    if (!userInfo?.groupCodes?.length && !userInfo?.modulePrivCodes?.length) {
        return []
    }
    let privs = userInfo.modulePrivCodes || []
    if (userInfo.groupCodes?.length) {
        let groups = await groupDac.getTop(1000, {groupCode: userInfo.groupCodes})
        groups.forEach(group => {
            privs = privs.concat(group.modulePrivCodes || [])
        })
    }

    return [...new Set(privs)]
}

/**
 * @description 更新用户的角色（修改 groupCodes)
 * @param {String} userCode 用户标识
 * @param {String} newRole 新的角色（即 groupCodes)
 * @returns {Promise<Object>} 更新结果
 */
export async function updateUserRole(userCode, newRole) {
    if (typeof userCode !== 'string') {
        userCode = String(userCode);
    }
    if (!userCode) {
        throw new Error('用户标识不能为空');
    }
    const userInfo = await userInfoDac.getByCode(userCode);
    if (!userInfo) {
        throw new Error('用户不存在或未找到');
    }
    if (!Array.isArray(newRole) || newRole.length === 0) {
        throw new Error('新角色不能为空');
    }
    userInfo.groupCodes = newRole;
    const updateResult = await userInfoDac.update(userInfo);
    if (updateResult) {
        return { code: 0, msg: '更新成功' };
    } else {
        return { code: -1, msg: '更新失败' };
    }
}

