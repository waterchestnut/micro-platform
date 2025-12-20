/**
 * @fileOverview 应用相关的业务操作
 * @author xianyang
 * @module
 */

import clientDac from '../../daos/core/dac/clientDac.js'
import retSchema from '../../daos/retSchema.js'
import {checkCodeField} from '../../tools/check.js'
import {saveUcenterClient} from '../../grpc/clients/client.js'
import {addModule} from '../../grpc/clients/module.js'
import {addPriv} from '../../grpc/clients/priv.js'
import {updateApisixRoute} from './apisix.js'
import EndpointTypeEnum from '../../daos/core/enum/EndpointTypeEnum.js'
import StatusEnum from '../../daos/core/enum/StatusEnum.js'
import {saveClientPageConfig} from './clientPageConfig.js'

const tools = app.tools
const logger = app.logger
const config = app.config

/**
 * @description 获取应用列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 应用数组}
 */
export async function getClients(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {order: -1, updateTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return clientDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 根据标识读取应用
 * @author menglb
 * @param {String} clientCode 应用标识
 * @returns {Promise<Object>} 应用对象
 */
export async function getClientByCode(clientCode) {
    return clientDac.getByCode(clientCode)
}

/**
 * @description 添加应用
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {Object} client 应用对象
 * @returns {Promise<Object>} 添加成功时返回新添加的应用对象
 */
export async function addClient(curUserInfo, client) {
    if (!client) {
        throw new Error('未传递应用数据')
    }
    if (!client.clientName || !client.clientCode) {
        throw new Error('需要应用名称和应用标识')
    }

    checkClientField(client)

    let oldClient = await clientDac.getByCode(client.clientCode)
    if (oldClient) {
        throw new Error('应用标识已存在')
    }

    let newClientInfo = {
        ...client,
        clientCode: client.clientCode,
        clientName: client.clientName,
        description: client.description,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
        tags: client.tags
    }
    await saveUcenterClient(curUserInfo, {
        clientCode: client.clientCode,
        clientName: client.clientName,
        status: 0,
        description: client.description
    })
    let ret = await clientDac.add(newClientInfo)

    // 添加默认的模块和权限
    const moduleCode = `${client.clientCode}-main`
    await addModule(curUserInfo, {
        moduleCode,
        moduleName: '主模块',
        clientCode: client.clientCode,
    })
    const modulePrivCode = `${client.clientCode}-browse`
    await addPriv(curUserInfo, {
        modulePrivCode,
        modulePrivName: '进入应用',
        clientCode: client.clientCode,
        moduleCode,
        privVerb: 'browse'
    })

    // 添加默认的API路由授权
    await saveClientPageConfig(curUserInfo, client.clientCode, [{
        'name': '公开接口',
        'path': '/public-bin/*',
        'auth': false,
        'clientAuth': false,
        'privs': [],
        'clientPrivs': []
    }])

    // 修改网关的代理路由信息
    updateApisixRoute(client.clientCode)

    return ret
}

/**
 * @description 修改应用
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {Object} newClient 新的应用对象
 * @returns {Promise<Object>} 受影响的行数
 */
export async function updateClient(curUserInfo, clientCode, newClient) {
    if (!clientCode) {
        throw new Error('缺少应用标识')
    }
    if (!newClient) {
        throw new Error('没有要更新的数据')
    }

    checkClientField(newClient)

    let client = {
        clientCode,
        clientName: newClient.clientName,
        description: newClient.description,
        tags: newClient.tags,
        endpoints: newClient.endpoints,
        needAuthProxy: newClient.needAuthProxy,
        upstreams: newClient.upstreams,
        needAuth2Show: newClient.needAuth2Show,
        toClients: newClient.toClients,
        order: newClient.order,
        logoUrl: newClient.logoUrl
    }

    await saveUcenterClient(curUserInfo, {
        clientCode,
        clientName: client.clientName,
        description: client.description,
        status: newClient.status,
    })
    let ret = await clientDac.update(client)

    // 修改网关的代理路由信息
    updateApisixRoute(client.clientCode)

    return ret
}

/**
 * @description 删除应用
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteClient(curUserInfo, clientCode) {
    if (!clientCode) {
        throw new Error('缺少应用标识')
    }

    await saveUcenterClient(curUserInfo, {
        clientCode,
        status: -1
    })
    return clientDac.update({clientCode, status: -1})
}

/**
 * @description 启用应用
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function enableClient(curUserInfo, clientCode) {
    if (!clientCode) {
        throw new Error('缺少应用标识')
    }

    await saveUcenterClient(curUserInfo, {
        clientCode,
        status: 0
    })
    return clientDac.update({clientCode, status: 0})
}

/**
 * @description 禁用应用
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function disableClient(curUserInfo, clientCode) {
    if (!clientCode) {
        throw new Error('缺少应用标识')
    }

    await saveUcenterClient(curUserInfo, {
        clientCode,
        status: 1
    })
    return clientDac.update({clientCode, status: 1})
}

/**
 * @description 校验应用相关字段的合法性
 * @author menglb
 * @param {Object} clientInfo 应用信息
 * @returns {Boolean} 校验是否通过
 */
function checkClientField(clientInfo) {
    if (!clientInfo) {
        return true
    }
    checkCodeField(clientInfo.clientCode, '应用标识')
    if (clientInfo.clientName) {
        if (!/^.{2,128}$/g.test(clientInfo.clientName)) {
            throw new Error('应用名称至少2个字符，且总长度不能超过128个字符')
        }
    }
    return true
}

/**
 * @description 获取PC端展示的全部应用
 * @author menglb
 * @returns {Promise<Array>} 应用列表
 */
export async function getPCShowClients() {
    let rows = await clientDac.getTop(2000, {
        endpointType: [EndpointTypeEnum.pc.value, EndpointTypeEnum.pcIframe.value],
        status: StatusEnum.normal.value
    }, {order: 1, updateTime: -1})

    return formatPublicClients(rows)
}

/**
 * @description 获取小程序端展示的全部应用
 * @author menglb
 * @returns {Promise<Array>} 应用列表
 */
export async function getMiniShowClients() {
    let rows = await clientDac.getTop(2000, {
        endpointType: [EndpointTypeEnum.miniH5.value, EndpointTypeEnum.miniNative.value],
        status: StatusEnum.normal.value
    }, {order: 1, updateTime: -1})

    return formatPublicClients(rows)
}

/**
 * @description 格式化开放的应用信息
 * @author menglb
 * @param {Array} clients 应用列表
 * @returns {Array} 格式化后的应用列表
 */
export function formatPublicClients(clients) {
    if (!clients?.length) {
        return clients
    }
    return clients?.map(row => {
        let item = {...row}
        delete item.needAuthProxy
        delete item.upstreams
        delete item.toClients
        delete item._id
        delete item.operator
        return item
    })
}