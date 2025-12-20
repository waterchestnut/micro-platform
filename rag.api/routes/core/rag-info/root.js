/**
 * @fileOverview 知识库相关的接口
 * @author xianyang
 * @module
 */

import * as ragInfoService from '../../../services/core/ragInfo.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/rag-info'

export default async function (fastify, opts) {
    const ragInfoSchema = {$ref: 'fullParamModels#/properties/RagInfo'}

    fastify.post('/add', {
        schema: {
            description: '添加单个知识库',
            summary: '添加单个知识库',
            body: ragInfoSchema,
            tags: ['rag'],
            response: {
                default: {...getResSwaggerSchema(ragInfoSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.addRagInfo(request.userInfo, request.reqParams)
    })
}
