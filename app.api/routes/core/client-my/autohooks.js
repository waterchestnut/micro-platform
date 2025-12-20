/**
 * @fileOverview 检查请求中是否包含有效clientCode，以及该应用是否为当前登录用户所创建
 * @author xianyang
 * @module
 */

import {getClientByCode} from '../../../services/core/client.js'

const tools = app.tools
const logger = app.logger

export default async function (fastify, opts) {
    fastify.addHook('preValidation', async (request, reply) => {
        /*console.log(request.hostname, request.routeOptions)*/
        if (request.routeOptions.url?.startsWith('/core/client-my/list')) {
            /*我的应用列表跳过校验*/
            return
        }

        let clientCode = request.reqParams?.clientCode
        if (!clientCode) {
            throw new Error('应用不存在')
        }
        let clientInfo = await getClientByCode(clientCode)
        if (clientInfo?.operator?.userCode !== request.userInfo?.userCode) {
            throw new Error('应用不存在')
        }
        request.clientInfo = clientInfo
    })
}
