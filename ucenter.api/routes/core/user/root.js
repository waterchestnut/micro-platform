import * as userInfoService from '../../../services/core/userInfo.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import {deleteBigField} from '../../../services/core/userUtils.js'
import {assignUserInfo} from '../../../services/auth/index.js'
import retSchema from '../../../daos/retSchema.js'
import {getUserPrivs} from '../../../services/core/userInfo.js'

export default async function (fastify, opts) {
    const userSchema = {$ref: 'fullParamModels#/properties/UserInfo'}

    fastify.get('/cur', {
        schema: {
            description: '当前用户信息接口，可通过此接口验证token是否有效',
            summary: '当前登录用户信息',
            tags: ['user'],
            response: {
                default: {
                    ...getResSwaggerSchema({$ref: 'fullParamModels#/properties/UserInfoWithToken'})
                }
            }
        }
    }, async function (request, reply) {
        if (!request.userInfo && !request.reqParams.accessToken) {
            return {...retSchema.FAIL_TOKEN_NO_REDIRECT}
        }
        if (!request.userInfo) {
            await assignUserInfo(request.reqParams, request)
        }
        if (!request.userInfo) {
            return {...retSchema.FAIL_TOKEN_NO_REDIRECT}
        }
        if (!request.userInfo.privs?.length) {
            request.userInfo.privs = await getUserPrivs(request.userInfo.userCode)
        }
        return deleteBigField(request.userInfo)
    })
    fastify.post('/list', {
        schema: {
            description: '获取用户列表',
            summary: '用户列表',
            body: {
                type: 'object',
                properties: {
                    filter: {type: 'object'},
                    pageIndex: {type: 'number'},
                    pageSize: {type: 'number'},
                    options: {
                        type: 'object',
                        properties: {
                            total: {type: 'number', description: '已知总数'},
                            sort: {
                                type: 'object',
                                description: '1:正序，-1：倒序',
                                additionalProperties: {type: 'number', enum: [1, -1]}
                            },
                        }
                    }
                }
            },
            tags: ['user-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(userSchema)}
            }
        }
    }, async function (request, reply) {
        return await userInfoService.getUserList(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

}
