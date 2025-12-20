/**
 * @fileOverview 检查请求中是否包含有效resCode，以及该资源是否为当前登录用户所创建
 * @author xianyang
 * @module
 */

import {getResInfo} from '../../../services/core/resInfo.js'

const tools = resource.tools
const logger = resource.logger

export default async function (fastify, opts) {
    fastify.addHook('preValidation', async (request, reply) => {
        /*console.log(request.hostname, request.routeOptions)*/
        if (request.routeOptions.url?.startsWith('/core/res-my/list')) {
            /*我的资源列表跳过校验*/
            return
        }

        let resCode = request.reqParams?.resCode
        if (!resCode) {
            throw new Error('资源不存在')
        }
        let resInfo = await getResInfo(resCode)
        if (resInfo?.operator?.userCode !== request.userInfo?.userCode) {
            throw new Error('资源不存在')
        }
        request.resInfo = resInfo
    })
}
