/**
 * @fileOverview 资源相关的接口
 * @author xianyang
 * @module
 */

import * as resInfoService from '../../../services/core/resInfo.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/res-info'

export default async function (fastify, opts) {
    const resInfoSchema = {$ref: 'fullParamModels#/properties/ResInfo'}

    fastify.post('/add', {
        schema: {
            description: '添加单个资源',
            summary: '添加单个资源',
            body: {
                type: 'object',
                properties: {
                    title: {type: 'string'},
                    resType: {type: 'string'},
                },
                required: ['title', 'resType']
            },
            tags: ['res'],
            response: {
                default: {...getResSwaggerSchema(resInfoSchema)}
            }
        }
    }, async function (request, reply) {
        return await resInfoService.addResInfo(request.userInfo, request.reqParams)
    })
}
