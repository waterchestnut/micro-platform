/**
 * @fileOverview 用户组相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import groupDac from '../../daos/core/dac/groupDac.js'
import AuthTypeEnum from '../../daos/core/enum/AuthTypeEnum.js'
import {getModulePrivs} from './modulePriv.js'
import modulePrivDac from '../../daos/core/dac/modulePrivDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 获取用户组列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 用户组数组}
 */
export async function getGroups(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }

    return groupDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 添加用户组
 * @author menglb
 * @param {Object} group 用户组对象
 * @returns {Object} userGroup对象
 */
export async function addGroup(group) {
    if (!group) {
        throw new Error('未传递用户组数据')
    }
    if (!group.groupName || !group.groupCode) {
        throw new Error('需要用户组名称和用户组标识')
    }
    let oldGroup = await groupDac.getByCode(group.groupCode)
    if (oldGroup) {
        throw new Error('用户组标识已存在')
    }

    let groupInfo = {
        groupCode: group.groupCode,
        groupName: group.groupName,
        description: group.description,
        orgCode: group.orgCode,
        status: 0,
        schemaCodes: group.schemaCodes,
        tags: group.tags,
        modulePrivCodes: group.modulePrivCodes,
        authType: AuthTypeEnum.managed.value
    }
    let ret = await groupDac.add(groupInfo)
    await upsertGroupDefaultPriv(groupInfo.groupCode, groupInfo.groupName)
    return ret
}

/**
 * @description 修改用户组基本信息
 * @author menglb
 * @param {String} groupCode 用户组标识
 * @param {Object} newGroup 新的用户组对象
 * @returns {Object} 受影响的行数
 */
export async function updateGroup(groupCode, newGroup) {
    if (!groupCode) {
        throw new Error('缺少用户组标识')
    }
    if (!newGroup) {
        throw new Error('没有要更新的数据')
    }

    let groupInfo = {
        groupCode,
        groupName: newGroup.groupName,
        description: newGroup.description,
        modulePrivCodes: newGroup.modulePrivCodes,
        tags: newGroup.tags
    }
    let ret = await groupDac.update(groupInfo)
    await upsertGroupDefaultPriv(groupInfo.groupCode, groupInfo.groupName)
    return ret
}

/**
 * @description 删除用户组基本信息
 * @author menglb
 * @param {String} groupCode 用户组标识
 * @returns {Object} 受影响的行数
 */
export async function deleteGroup(groupCode) {
    if (!groupCode) {
        throw new Error('缺少用户组标识')
    }

    /** 能否删除的校验 */
    let group = await groupDac.getByCode(groupCode)
    if (!group) {
        throw new Error('用户组不存在')
    }
    if (group.authType !== AuthTypeEnum.managed.value) {
        throw new Error('内置用户组，无法删除')
    }

    return groupDac.update({groupCode, status: -1})
}

/**
 * @description 更新用户组的权限列表
 * @author menglb
 * @param {String} groupCode 用户组标识
 * @param {Array} privCodes 新的权限标识列表
 * @returns {Object} 更新后的权限列表
 */
export async function updateGroupPrivs(groupCode, privCodes) {
    await groupDac.update({groupCode, modulePrivCodes: privCodes})
    /*@todo 清理权限的缓存*/
    return privCodes
}

/**
 * @description 按应用更新用户组的权限列表
 * @author menglb
 * @param {Object} curUserInfo 当前登录用户
 * @param {String} clientCode 应用标识
 * @param {String} groupCode 用户组标识
 * @param {Array} privCodes 新的权限标识列表
 * @returns {Promise<Number>} 更新的权限数目
 */
export async function updateGroupPrivsByClient(curUserInfo, clientCode, groupCode, privCodes) {
    let groupInfo = await groupDac.getByCode(groupCode)
    if (!groupInfo) {
        throw new Error('用户组不存在')
    }
    let modulePrivCodes = groupInfo.modulePrivCodes || []
    let clientPrivs = ((await getModulePrivs({clientCode}, 1, 3000)).rows || []).map(_ => _.modulePrivCode)
    let privs = modulePrivCodes.filter(_ => !clientPrivs.includes(_))
    let count = 0
    privCodes.forEach(_ => {
        if (clientPrivs.includes(_)) {
            count += 1
            privs.push(_)
        }
    })
    /*console.log(privCodes, clientPrivs, privs)*/
    await groupDac.update({groupCode, modulePrivCodes: privs})
    /*@todo 清理权限的缓存*/
    return count
}

/**
 * @description 添加或更新用户组默认对应的权限
 * @author menglb
 * @param {String} groupCode 用户组标识
 * @param {String} groupName 用户组名称
 * @returns {Promise<Object>} 更新成功后的权限对象
 */
export async function upsertGroupDefaultPriv(groupCode, groupName) {
    return modulePrivDac.upsert({
        modulePrivCode: groupCode,
        modulePrivName: `角色内置权限（${groupName || groupCode}）`,
        privVerb: 'browse',
        moduleCode: 'ucenter-main',
        status: 0,
        authType: 1,
        clientCode: 'ucenter'
    })
}