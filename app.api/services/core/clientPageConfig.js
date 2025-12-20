/**
 * @fileOverview 应用下的API配置授权相关的业务操作
 * @author xianyang
 * @pageConfig
 */

import {savePageConfig, getPageConfig} from '../../grpc/clients/pageConfig.js'
import {md5} from '../../tools/security.js'

const tools = app.tools
const logger = app.logger
const config = app.config

/**
 * @description 获取配置列表
 * @author xianyang
 * @param {String} clientCode 应用标识
 * @returns {Promise<[Object]>} 配置数组
 */
export async function getClientPageConfigs(clientCode) {
    return getPageConfig(clientCode)
}

/**
 * @description 保存配置
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {Array} pageConfigs 配置对象列表
 * @returns {Promise<Number>} 修改的行数
 */
export async function saveClientPageConfig(curUserInfo, clientCode, pageConfigs = []) {
    if (!pageConfigs?.length) {
        throw new Error('未传递配置数据')
    }
    let exists = {}
    pageConfigs.forEach((pageConfig, index) => {
        let pageConfigCode = md5(`${clientCode}-${pageConfig.path}`)
        if (exists[pageConfigCode]) {
            throw new Error('配置中的path不能相同')
        }
        exists[pageConfigCode] = 1
        pageConfig.pageConfigCode = pageConfigCode
        pageConfig.auth = pageConfig.auth || false
        pageConfig.clientAuth = pageConfig.clientAuth || false
        pageConfig.privs = pageConfig.privs || []
        pageConfig.clientPrivs = pageConfig.clientPrivs || []
        pageConfig.method = [
            'GET',
            'POST',
            'PUT',
            'DELETE',
            'PATCH',
            'HEAD',
            'OPTIONS',
            'CONNECT',
            'TRACE'
        ]
        pageConfig.orderNum = index
    })

    return savePageConfig(curUserInfo, clientCode, pageConfigs)
}