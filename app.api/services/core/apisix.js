/**
 * @fileOverview 与网关交互相关的操作
 * @author xianyang
 * @module
 */

import clientDac from '../../daos/core/dac/clientDac.js'
import retSchema from '../../daos/retSchema.js'
import fs from 'fs/promises'

const tools = app.tools
const logger = app.logger
const config = app.config
const apisixConfig = config.apisixConfig

/**
 * @description 更新应用的路由
 * @author xianyang
 * @param {String} clientCode 应用标识
 * @returns {Promise<Boolean>} 更新是否成功
 */
export async function updateApisixRoute(clientCode) {
    let clientInfo = await clientDac.getByCode(clientCode)
    if (!clientInfo?.upstreams?.length) {
        return false
    }

    let res
    try {
        res = await fetch(`${apisixConfig.adminBaseUrl}/apisix/admin/routes/r-${clientCode}`, {
            method: 'PUT',
            headers: {
                'X-API-KEY': apisixConfig.adminKey,
            },
            body: JSON.stringify(await getClientRouteData(clientCode, clientInfo.clientName, clientInfo.upstreams, clientInfo.needAuthProxy))
        })
        const json = await res.json()
        console.log(json)
    } catch (err) {
        logger.error(err)
        logger.error(res?.body)
    }
    return true
}

/**
 * @description 获取所有的路由配置
 * @author xianyang
 * @returns {Promise<Object>} 分页路由数据
 */
export async function getApisixRoutes() {
    const res = await fetch(`${apisixConfig.adminBaseUrl}/apisix/admin/routes`, {
        method: 'GET',
        headers: {
            'X-API-KEY': apisixConfig.adminKey,
        },
    })
    const json = await res.json()
    console.log(json)
    return true
}

/**
 * @description 加载授权的apisix serverless插件函数
 * @author xianyang
 * @param {String} authUpstream 授权中心上游地址
 * @returns {Promise<String>} serverless插件函数字符串
 */
export async function loadAuthServerless(authUpstream) {
    let data = await fs.readFile(`${app.baseDir}conf/apisix-auth-proxy-tmpl.lua`, {encoding: 'utf8'})
    /*console.log(data);*/
    return data.replaceAll('{auth-upstream}', authUpstream)
}

/**
 * @description 拼接应用路由代理的JSON数据
 * @author xianyang
 * @param {String} clientCode 应用标识
 * @param {String} clientName 应用名称
 * @param {[String]} upstreams 应用的上游地址
 * @param {Boolean} needAuthProxy 是否需要代理权限验证
 * @returns {Promise<Object>} 路由代理的JSON数据
 */
export async function getClientRouteData(clientCode, clientName, upstreams, needAuthProxy = true) {
    let nodes = {}
    upstreams.forEach(upstream => {
        nodes[upstream.host] = upstream.weight || 1
    })
    let route = {
        'uri': `/${clientCode}/*`,
        'name': `${clientName}全部接口`,
        'methods': [
            'GET',
            'POST',
            'PUT',
            'DELETE',
            'PATCH',
            'HEAD',
            'OPTIONS',
            'CONNECT',
            'TRACE'
        ],
        'plugins': {
            'proxy-rewrite': {
                'regex_uri': [
                    `/${clientCode}/(.*)`,
                    '/$1'
                ]
            },
            'cors': {
                'allow_credential': false,
                'allow_headers': '*',
                'allow_methods': 'GET,POST,OPTIONS',
                'allow_origins': '*',
                'allow_origins_by_regex': [
                    '.*.bogupeijin.com',
                    '.*.paretop.net',
                    '.*localhost:.*'
                ],
                'expose_headers': '*',
                'max_age': 1728000
            },
            'serverless-pre-function': {
                'functions': [],
                'phase': 'access'
            }
        },
        'upstream': {
            'type': 'roundrobin',
            'nodes': nodes,
            'timeout': {
                'connect': 360,
                'send': 360,
                'read': 360
            },
            'scheme': 'http',
            'pass_host': 'pass',
            'keepalive_pool': {
                'idle_timeout': 600,
                'requests': 1000,
                'size': 320
            }
        },
        'labels': {
            'API_VERSION': 'v1'
        },
        'status': 1
    }
    if (needAuthProxy) {
        route.plugins['serverless-pre-function'].functions = [
            await loadAuthServerless(apisixConfig.authUpstream),
        ]
    } else {
        delete route.plugins['serverless-pre-function']
    }

    return route
}