/**
 * @fileOverview 我的知识库相关的接口
 * @author xianyang 2025/7/4
 * @module
 */

import * as ragInfoService from '../../../services/core/ragInfo.js'
import {registerCommonRoutes} from '../rag-info/ipmi.js'
import {getPageListResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/rag-my'

export default async function (fastify, opts) {
    const ragInfoSchema = {$ref: 'fullParamModels#/properties/RagInfo'}

    fastify.post('/list', {
        schema: {
            description: '获取我创建的知识库列表',
            summary: '知识库列表',
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
            tags: ['rag-my'],
            response: {
                default: {...getPageListResSwaggerSchema(ragInfoSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.getRagInfos({
            ...request.reqParams.filter,
            operatorUserCode: request.userInfo.userCode
        }, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    registerCommonRoutes(fastify, opts, ['rag-my'])
}
