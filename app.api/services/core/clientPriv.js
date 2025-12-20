/**
 * @fileOverview 应用下的权限相关的业务操作
 * @author xianyang
 * @priv
 */

import {addPriv, deletePriv, getPrivList} from '../../grpc/clients/priv.js'
import {checkCodeField} from '../../tools/check.js'
import {getGroupList, saveGroupPrivs} from '../../grpc/clients/group.js'
import {md5} from '../../tools/security.js'
import {allocPrivsToOtherClient, getUcenterClientList} from '../../grpc/clients/client.js'

const tools = app.tools
const logger = app.logger
const config = app.config

/**
 * @description 获取权限列表
 * @author xianyang
 * @param {String} clientCode 应用标识
 * @returns {Promise<[Object]>} 权限数组
 */
export async function getClientPrivs(clientCode) {
    return getPrivList(clientCode)
}

/**
 * @description 添加权限
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {Object} priv 权限对象
 * @returns {Object} 添加成功时返回新添加的权限对象
 */
export async function addClientPriv(curUserInfo, clientCode, priv) {
    if (!priv) {
        throw new Error('未传递权限数据')
    }
    if (!priv.modulePrivName || !priv.modulePrivCode || !priv.moduleCode) {
        throw new Error('需要权限名称、权限标识和模块标识')
    }

    checkCodeField(priv.modulePrivCode, '权限标识')
    const modulePrivCode = priv.modulePrivCode.startsWith(`${clientCode}-`) ? priv.modulePrivCode : `${clientCode}-${priv.modulePrivCode}`

    let newPrivInfo = {
        modulePrivCode,
        modulePrivName: priv.modulePrivName,
        clientCode: clientCode,
        moduleCode: priv.moduleCode,
        privVerb: 'browse'
    }

    return addPriv(curUserInfo, newPrivInfo)
}

/**
 * @description 删除权限
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {String} modulePrivCode 权限标识
 * @returns {Object} 受影响的行数
 */
export async function deleteClientPriv(curUserInfo, clientCode, modulePrivCode) {
    if (!clientCode) {
        throw new Error('缺少应用标识')
    }
    if (modulePrivCode === `${clientCode}-browse`) {
        throw new Error('基础权限，不能删除')
    }

    let privList = await getPrivList(clientCode)
    if (!privList?.find(_ => _.modulePrivCode === modulePrivCode)) {
        throw new Error('权限不存在')
    }

    return deletePriv(curUserInfo, modulePrivCode)
}

/**
 * @description 获取用户组列表
 * @author xianyang
 * @param {String} clientCode 应用标识
 * @returns {Promise<[Object]>} 用户组数组
 */
export async function getGroups(clientCode) {
    let list = await getGroupList(clientCode)
    let groups = []
    list.forEach((_) => {
        let modulePrivCodes = _.modulePrivCodes?.filter(code => code.startsWith(`${clientCode}-`)) || []
        groups.push({
            groupCode: _.groupCode,
            groupName: _.groupName,
            modulePrivCodes
        })
    })
    return groups
}

/**
 * @description 保存用户组权限
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {Array} modulePrivCodes 权限列表
 * @param {String}  groupCode 用户组标识
 * @returns {Promise<Number>} 修改的行数
 */
export async function saveGroupClientPrivs(curUserInfo, clientCode, modulePrivCodes, groupCode) {
    return saveGroupPrivs(curUserInfo, clientCode, modulePrivCodes?.filter(code => code.startsWith(`${clientCode}-`)) || [], groupCode)
}

/**
 * @description 获取分配给其他应用的权限
 * @author xianyang
 * @param {String} clientCode 应用标识
 * @param {Array} toClientCodes 其他应用标识列表
 * @returns {Promise<[Object]>} 应用权限数组
 */
export async function getOtherClientPrivs(clientCode, toClientCodes) {
    let list = await getUcenterClientList(toClientCodes)
    let clients = []
    list.forEach((_) => {
        let modulePrivCodes = _.modulePrivCodes?.filter(code => code.startsWith(`${clientCode}-`)) || []
        clients.push({
            clientCode: _.clientCode,
            clientName: _.clientName,
            modulePrivCodes
        })
    })
    return clients
}

/**
 * @description 保存给其他应用分配的权限
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {Array} modulePrivCodes 角色列表
 * @param {String}  toClientCode 其他应用标识
 * @returns {Promise<Number>} 修改的行数
 */
export async function saveOtherClientPrivs(curUserInfo, clientCode, modulePrivCodes, toClientCode) {
    return allocPrivsToOtherClient(curUserInfo, clientCode, modulePrivCodes?.filter(code => code.startsWith(`${clientCode}-`)) || [], toClientCode)
}