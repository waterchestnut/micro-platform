/**
 * @fileOverview 页面路由权限配置的匹配查找等
 * @author xianyang 2024/6/26
 * @module
 */

import pageConfigDac from '../../daos/core/dac/pageConfigDac.js'
import FindMyWay from 'find-my-way'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

let clientRouter = {}

/**
 * @description 加载路由权限配置
 * @author menglb
 */
export async function loadPageConfig() {
    let configs = await pageConfigDac.findAllPageConfig()
    configs.sort((a, b) => {
        if (a.clientCode !== b.clientCode) return a.clientCode - b.clientCode
        if (a.orderNum !== b.orderNum) return a.orderNum - b.orderNum
        return 0
    })
    clientRouter = {}
    configs.forEach(config => {
        if (config.status === 0 && config.clientCode) {
            clientRouter[config.clientCode] = clientRouter[config.clientCode] || new FindMyWay({})
            try {
                clientRouter[config.clientCode].on(config.method, config.path, async (req, res, params, store, searchParams) => {
                    return {
                        params,
                        store,
                        searchParams,
                        config
                    }
                })
            } catch (err) {
                logger.error(`Failed to register page config, path:${config.path}, method:${config.method}, error: ${err}`)
            }
        }
    })
}

/**
 * @description 匹配页面配置信息
 * @author menglb
 * @param {String} path 请求路径
 * @param {String} method 请求方法
 * @returns {Object} 匹配到的页面配置信息
 */
export async function matchPageConfig(path, method) {
    if (!method || !path) {
        return null
    }
    let paths = path.split('/')
    if (paths.length <= 1) {
        return null
    }
    let clientCode = paths[1]
    if (!clientRouter[clientCode]) {
        return null
    }
    let clientPath
    if (paths.length === 2) {
        clientPath = '/'
    } else {
        paths.splice(1, 1)
        clientPath = paths.join('/')
    }
    /*console.log(clientRouter[clientCode], clientPath)*/
    const matchedRouter = clientRouter[clientCode].find(method, clientPath)
    if (!matchedRouter) {
        return null
    }
    let ret = await matchedRouter.handler({}, {}, matchedRouter.params)
    return ret.config
}