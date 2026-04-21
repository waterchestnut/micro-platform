/**
 * @fileOverview 用户首页应用相关的业务操作
 * @author xianyang
 * @module
 */

import homeClientDac from '../../daos/core/dac/homeClientDac.js'
import {getClientByCode} from './client.js'
import HomeTypeEnum from '../../daos/core/enum/HomeTypeEnum.js'
import clientDac from '../../daos/core/dac/clientDac.js'

/**
 * @description 获取用户首页应用列表
 * @param {String} userCode 用户标识
 * @param {String} homeEndpoint 首页访问端（pc/mini）
 * @returns {Promise<Array>} 首页应用列表
 */
export async function getHomeClients(userCode, homeEndpoint) {
    let records = await homeClientDac.getListByUserCode(userCode, homeEndpoint)

    let addedClientCodes = new Set()
    let removedClientCodes = new Set()
    records.forEach(r => {
        if (r.homeType === HomeTypeEnum.add.value) {
            addedClientCodes.add(r.clientCode)
        } else if (r.homeType === HomeTypeEnum.remove.value) {
            removedClientCodes.add(r.clientCode)
        }
    })

    let defaultClients = await clientDac.getTop(100, {status: 0, complexFilter: {default2Home: true}}, {order: 1})

    let result = []
    defaultClients.forEach(c => {
        if (addedClientCodes.has(c.clientCode)) {
            result.push({clientCode: c.clientCode, homeEndpoint, order: c.order, fromUser: true})
        } else if (!removedClientCodes.has(c.clientCode)) {
            result.push({clientCode: c.clientCode, homeEndpoint, order: c.order, fromUser: false})
        }
    })

    records.forEach(r => {
        if (r.homeType === HomeTypeEnum.add.value && !result.find(item => item.clientCode === r.clientCode)) {
            result.push({...r, fromUser: true})
        }
    })

    result.sort((a, b) => a.order - b.order)
    return result
}

/**
 * @description 批量保存用户首页应用
 * @param {Object} curUserInfo 当前用户
 * @param {String[]} clientCodes 应用标识数组
 * @param {String} homeEndpoint 首页访问端
 * @returns {Promise<Object[]>} 保存结果
 */
export async function saveHomeClients(curUserInfo, clientCodes, homeEndpoint = 'pc') {
    if (!clientCodes || !clientCodes.length) {
        return []
    }

    let clients = await clientDac.getTop(clientCodes.length, {status: 0, clientCode: clientCodes})

    let upsertInfos = []
    for (let i = 0; i < clientCodes.length; i++) {
        let clientCode = clientCodes[i]
        let client = clients.find(c => c.clientCode === clientCode)
        if (!client) {
            continue
        }

        let homeClientInfo = {
            homeClientCode: homeClientDac.getHomeClientCode(curUserInfo.userCode, clientCode, homeEndpoint),
            clientCode,
            userCode: curUserInfo.userCode,
            homeEndpoint,
            homeType: HomeTypeEnum.add.value,
            order: i
        }
        upsertInfos.push(homeClientInfo)
    }

    return homeClientDac.bulkUpdate(upsertInfos)
}

/**
 * @description 添加应用到用户首页
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {String} homeEndpoint 首页访问端
 * @param {Number} order 排序
 * @returns {Promise<Object>} 添加成功时返回首页应用对象
 */
export async function addHomeClient(curUserInfo, clientCode, homeEndpoint = 'pc', order = 0) {
    if (!clientCode) {
        throw new Error('缺少应用标识')
    }

    let client = await getClientByCode(clientCode)
    if (!client) {
        throw new Error('应用不存在')
    }

    let homeClientInfo = {
        homeClientCode: homeClientDac.getHomeClientCode(curUserInfo.userCode, clientCode, homeEndpoint),
        clientCode,
        userCode: curUserInfo.userCode,
        homeEndpoint,
        homeType: HomeTypeEnum.add.value,
        order
    }

    return homeClientDac.upsert(homeClientInfo)
}

/**
 * @description 从用户首页移除应用
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {String} homeEndpoint 首页访问端
 * @param {Number} order 排序
 * @returns {Promise<Object>} 移除结果
 */
export async function removeHomeClient(curUserInfo, clientCode, homeEndpoint = 'pc', order = 0) {
    if (!clientCode) {
        throw new Error('缺少应用标识')
    }

    let homeClientInfo = {
        homeClientCode: homeClientDac.getHomeClientCode(curUserInfo.userCode, clientCode, homeEndpoint),
        clientCode,
        userCode: curUserInfo.userCode,
        homeEndpoint,
        homeType: HomeTypeEnum.remove.value,
        order
    }

    return homeClientDac.upsert(homeClientInfo)
}
