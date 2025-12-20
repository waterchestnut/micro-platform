/**
 * @fileOverview 初始化参数、配置等
 * @author xianyang
 * @module plugins/init-params
 */

import fp from 'fastify-plugin'
import * as security from '../tools/security.js'

const tools = doc.tools
const logger = doc.logger
const config = doc.config

export default fp(async function (fastify, opts) {
    fastify.addHook('preValidation', async (request, reply) => {
        /*console.log(request.hostname, request.routeOptions)*/
        let reqParams = {}
        /* cookies */
        if (request.cookies) {
            for (let key in request.cookies) {
                if (!key.startsWith('param-')) {
                    continue
                }
                reqParams[key.replace(/^param-/, '')] = request.cookies[key]
            }
        }

        /* headers */
        if (request.headers) {
            for (let key in request.headers) {
                // 解析当前登录的用户信息
                if (key === 'user-info') {
                    try {
                        request.userInfo = JSON.parse(decodeURIComponent(security.base64Decode(request.headers[key])))
                    } catch (e) {
                        logger.error('解析当前登录的用户信息出错：' + e)
                    }
                    continue
                }

                // 解析当前授权的第三方客户端信息
                if (key === 'client-info') {
                    try {
                        request.clientInfo = JSON.parse(security.base64Decode(request.headers[key]))
                    } catch (e) {
                        logger.error('解析当前授权的第三方客户端信息：' + e)
                    }
                    continue
                }

                if (!key.startsWith('param-')) {
                    continue
                }
                reqParams[key.replace(/^param-/, '').replace(/clientaccesstoken/, 'clientAccessToken').replace(/clientrefreshtoken/, 'clientRefreshToken').replace(/accesstoken/, 'accessToken').replace(/refreshtoken/, 'refreshToken')] = request.headers[key]
            }
        }

        request.reqParams = Object.assign(reqParams, request.query, request.body, request.params)
    })
})
