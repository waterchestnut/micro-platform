/**
 * @fileOverview CARSI 教育联邦认证 OAuth2 接口
 * @author
 * @module
 */

import * as carsiService from '../../../services/carsi/carsiLogin.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

const config = ucenter.config

export const autoPrefix = '/public-bin/carsi'

export default async function (fastify, opts) {

    fastify.get('/login', {
        schema: {
            description: 'CARSI OAuth登录跳转',
            summary: 'CARSI登录',
            tags: ['public-bin', 'carsi'],
            response: {default: {...getResSwaggerSchema()}}
        }
    }, async function (request, reply) {
        const loginUrl = await carsiService.getCarsiLoginUrl()
        if (loginUrl) {
            return reply.redirect(loginUrl)
        }
        return reply.type('text/html').send('<html><body style="text-align:center;padding-top:80px"><p style="color:red">CARSI登录未配置</p></body></html>')
    })

    fastify.get('/callback', {
        schema: {
            description: 'CARSI OAuth回调',
            summary: 'CARSI回调',
            querystring: {
                type: 'object',
                properties: {
                    code: {type: 'string', description: '授权码'},
                    state: {type: 'string', description: '状态标识'}
                },
                required: ['code', 'state']
            },
            tags: ['public-bin', 'carsi'],
            response: {default: {...getResSwaggerSchema()}}
        }
    }, async function (request, reply) {
        const result = await carsiService.handleCarsiCallback(request.reqParams.code, request.reqParams.state)

        if (result.code === 0 && !result.data?.status) {
            const userInfo = result.data
            reply
                .setCookie('param-accessToken', userInfo.accessToken, {path: '/'})
                .setCookie('param-refreshToken', userInfo.refreshToken || '', {path: '/'})
                .type('text/html')
                .send('<html><body style="text-align:center;padding-top:60px;font-family:sans-serif"><p style="font-size:18px">登录成功</p><script>if(window.opener){window.opener.postMessage({type:"carsiLogin",success:true,carsiRole:"' + (userInfo.carsiRole || '') + '"},"*")}setTimeout(function(){window.close()},800)</script></body></html>')
            return
        }

        if (result.data?.status === 'unregistered') {
            reply.type('text/html')
                .send('<html><body style="text-align:center;padding-top:60px;font-family:sans-serif"><p style="color:red;font-size:16px">该CARSI账号未关联平台账号，请先登录后绑定</p><script>if(window.opener){window.opener.postMessage({type:"carsiLogin",success:false,unregistered:true},"*")}setTimeout(function(){window.close()},2000)</script></body></html>')
            return
        }

        reply.type('text/html')
            .send('<html><body style="text-align:center;padding-top:60px;font-family:sans-serif"><p style="color:red">登录失败：' + (result.msg || '') + '</p><script>if(window.opener){window.opener.postMessage({type:"carsiLogin",success:false},"*")}setTimeout(function(){window.close()},2000)</script></body></html>')
    })

    fastify.get('/config', {
        schema: {
            description: '获取CARSI登录配置状态',
            summary: 'CARSI配置',
            tags: ['public-bin', 'carsi'],
            response: {
                default: {
                    ...getResSwaggerSchema({
                        type: 'object',
                        properties: {
                            enabled: {type: 'boolean', description: 'CARSI登录是否已配置'}
                        }
                    })
                }
            }
        }
    }, async function (request, reply) {
        return await carsiService.getCarsiConfig()
    })
}