/**
 * @fileOverview 该路径下的访问附加用户信息
 * @author xianyang
 * @module
 */
import {assignUserInfo} from '../../services/auth/index.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

export default async function (fastify, opts) {
    fastify.addHook('preValidation', async (request, reply) => {
        /*console.log(request.hostname, request.routeOptions)*/
        if (!request.reqParams?.accessToken) {
            return
        }
        await assignUserInfo(request.reqParams, request)
    })
}
