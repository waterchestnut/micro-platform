/**
 * @fileOverview 我的资源相关的接口
 * @author xianyang
 * @module
 */

import * as resInfoService from '../../../services/core/resInfo.js'
import {registerCommonRoutes} from '../res-info/ipmi.js'
import {getPageListResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/res-my'

export default async function (fastify, opts) {
    const resInfoSchema = {$ref: 'fullParamModels#/properties/ResInfo'}

    fastify.post('/list', {
        schema: {
            description: '获取我创建的资源列表',
            summary: '资源列表',
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
            tags: ['res-my'],
            response: {
                default: {...getPageListResSwaggerSchema(resInfoSchema)}
            }
        }
    }, async function (request, reply) {
        return await resInfoService.getResInfos({
            ...request.reqParams.filter,
            operatorUserCode: request.userInfo.userCode
        }, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    registerCommonRoutes(fastify, opts, ['res-my'])
}
