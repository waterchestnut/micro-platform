/**
 * @fileOverview 接入应用相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import clientDac from '../../daos/core/dac/clientDac.js'
import {getModulePrivs} from './modulePriv.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 获取接入应用列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 接入应用数组}
 */
export async function getClients(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return clientDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 根据标识读取接入应用
 * @author menglb
 * @param {String} clientCode 应用标识
 * @returns {Promise<Object>} 接入应用对象
 */
export async function getClientByCode(clientCode) {
    return clientDac.getByCode(clientCode)
}

/**
 * @description 添加接入应用
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {Object} client 接入应用对象
 * @returns {Promise<Object>} 添加成功时返回新添加的接入应用对象
 */
export async function addClient(curUserInfo, client) {
    if (!client) {
        throw new Error('未传递接入应用数据')
    }
    if (!client.clientName || !client.clientCode) {
        throw new Error('需要接入应用名称和接入应用标识')
    }

    let oldClient = await clientDac.getByCode(client.clientCode)
    if (oldClient) {
        throw new Error('接入应用标识已存在')
    }

    let oauthClient = {
        clientCode: client.clientCode,
        clientName: client.clientName,
        clientSecret: client.clientSecret || tools.getUUID(),
        retUrls: client.retUrls,
        grantTypes: client.grantTypes,
        scopes: client.scopes,
        loginUrls: client.loginUrls,
        logoutUrls: client.logoutUrls,
        description: client.description,
        userCode: curUserInfo.userCode,
        status: 0,
        tags: client.tags
    }

    return clientDac.add(oauthClient)
}

/**
 * @description 修改接入应用
 * @author menglb
 * @param {String} clientCode 接入应用标识
 * @param {Object} newClient 新的接入应用对象
 * @returns {Promise<Object>} 新的接入应用对象
 */
export async function updateClient(clientCode, newClient) {
    if (!clientCode) {
        throw new Error('缺少接入应用标识')
    }
    if (!newClient) {
        throw new Error('没有要更新的数据')
    }

    let client = {
        clientCode,
        clientName: newClient.clientName,
        description: newClient.description,
        clientSecret: newClient.clientSecret,
        retUrls: newClient.retUrls,
        grantTypes: newClient.grantTypes,
        scopes: newClient.scopes,
        loginUrls: newClient.loginUrls,
        logoutUrls: newClient.logoutUrls,
        tags: newClient.tags,
        modulePrivCodes: newClient.modulePrivCodes,
    }

    return clientDac.upsert(client)
}

/**
 * @description 删除接入应用
 * @author menglb
 * @param {String} clientCode 接入应用标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteClient(clientCode) {
    if (!clientCode) {
        throw new Error('缺少接入应用标识')
    }

    return clientDac.update({clientCode, status: -1})
}

/**
 * @description 启用接入应用
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 接入应用标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function enableClient(curUserInfo, clientCode) {
    if (!clientCode) {
        throw new Error('缺少接入应用标识')
    }

    return clientDac.update({clientCode, status: 0})
}

/**
 * @description 禁用接入应用
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 接入应用标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function disableClient(curUserInfo, clientCode) {
    if (!clientCode) {
        throw new Error('缺少接入应用标识')
    }

    return clientDac.update({clientCode, status: 1})
}

/**
 * @description 生成应用秘钥
 * @author menglb
 * @returns {String} 秘钥
 */
export function genClientSecret() {
    return tools.getUUID()
}

/**
 * @description 获取所有配置的第三方应用的统一登录/退出地址
 * @author menglb
 * @returns {Promise<Object>} 应用统一登录/退出登录地址列表：{signInUrls: 单点登录地址数组, signOutUrls: 单点退出登录地址数组}
 */
export async function getSSOSignUrls() {
    let signInUrls = []
    let signOutUrls = []
    let rows = await clientDac.getTop(10000, {status: 0})
    if (!rows?.length) {
        return {signInUrls, signOutUrls}
    }

    rows.forEach(clientInfo => {
        if (clientInfo.loginUrls?.length) {
            signInUrls = signInUrls.concat(clientInfo.loginUrls)
        }
        if (clientInfo.logoutUrls?.length) {
            signOutUrls = signOutUrls.concat(clientInfo.logoutUrls)
        }
    })

    return {signInUrls, signOutUrls}
}

/**
 * @description 给其他应用分配当前应用拥有的权限
 * @author menglb
 * @param {Object} curUserInfo 当前登录用户
 * @param {String} clientCode 当前应用标识
 * @param {String} toClientCode 其他应用标识
 * @param {Array} privCodes 新的权限标识列表
 * @returns {Promise<Number>} 更新的权限数目
 */
export async function allocPrivsToOtherClient(curUserInfo, clientCode, toClientCode, privCodes) {
    let toClientInfo = await clientDac.getByCode(toClientCode)
    if (!toClientInfo) {
        logger.error(`其他应用不存在：${toClientCode}`)
        return 0
    }
    let modulePrivCodes = toClientInfo.modulePrivCodes || []
    let clientPrivs = ((await getModulePrivs({clientCode}, 1, 3000)).rows || []).map(_ => _.modulePrivCode)
    let privs = modulePrivCodes.filter(_ => !clientPrivs.includes(_))
    let count = 0
    privCodes.forEach(_ => {
        if (clientPrivs.includes(_)) {
            count += 1
            privs.push(_)
        }
    })

    await clientDac.update({clientCode: toClientCode, modulePrivCodes: privs})
    return count
}