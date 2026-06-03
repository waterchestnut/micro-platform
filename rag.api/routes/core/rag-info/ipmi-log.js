/**
 * @fileOverview 知识库操作日志管理相关的接口（系统管理员）
 * @module
 */

import * as ragOperationLogService from '../../../services/core/ragOperationLog.js'
import {getPageListResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/rag-info/ipmi-log'

export function registerCommonRoutes(fastify, opts, tags = ['rag-ipmi']) {

    fastify.post('/list', {
        schema: {
            description: '获取知识库操作日志列表',
            summary: '操作日志列表',
            body: {
                type: 'object',
                properties: {
                    ragCode: {type: 'string'},
                    logType: {type: 'string'},
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
                },
                required: ['ragCode']
            },
            tags,
            response: {
                default: {...getPageListResSwaggerSchema({type: 'object'})}
            }
        }
    }, async function (request, reply) {
        return await ragOperationLogService.getLogs(
            request.reqParams.ragCode,
            request.reqParams.pageIndex,
            request.reqParams.pageSize,
            {logType: request.reqParams.logType, ...request.reqParams.options}
        )
    })
}

export default async function (fastify, opts) {
    registerCommonRoutes(fastify, opts)
}
