/**
 * @fileOverview 应用端代理校验，检查请求header中是否包含有效clientCode
 * @author xianyang
 * @module
 */
import clientDac from '../../daos/core/dac/clientDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config
const clientProxyConfig = config.clientProxy

export default async function (fastify, opts) {
    fastify.addHook('onRequest', async (request, reply) => {
        /*console.log(request.hostname, request.routeOptions)*/
        if (!tools.isExist(request.headers['client-code'])) {
            throw new Error('客户端不存在，请检查访问路径是否正确')
        }
        if (clientProxyConfig.clients[request.headers['client-code']]) {
            request.clientConfig = clientProxyConfig.clients[request.headers['client-code']]
        } else {
            let clientInfo = await clientDac.getByCode(request.headers['client-code'])
            if (!clientInfo?.clientCode) {
                throw new Error('客户端不存在，请检查访问路径是否正确')
            }
            request.clientConfig = {
                /** 用户中心外网基地址 */
                baseUrl: config.baseUrl,
                /** 应用代码 */
                clientCode: clientInfo.clientCode,
                /** 授权密钥 */
                clientSecret: clientInfo.clientSecret,
                /** 登录界面的版本 */
                version: 'v1',
            }
        }
    })
}
