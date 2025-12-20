/**
 * @fileOverview 知识库召回相关的接口
 * @author xianyang 2025/7/4
 * @module
 */

import {getListResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import {ragSearch} from '../../../services/core/ragSearch.js'

export const autoPrefix = '/core/rag-search'

export default async function (fastify, opts) {
    const ragSearchItemSchema = {$ref: 'fullParamModels#/properties/RagSearchItem'}

    fastify.post('/search', {
        schema: {
            description: '根据输入文本，召回知识库片段',
            summary: '知识库内容召回',
            body: {
                type: 'object',
                properties: {
                    subject: {type: 'string', description: '查询文本'},
                    options: {
                        type: 'object',
                        properties: {
                            maxLength: {type: 'number', description: '最大召回片段数目'},
                            ragCode: {type: 'string', description: '知识库标识'},
                            withChunks: {type: 'number', description: '是否返回命中的片段'},
                        }
                    }
                }
            },
            tags: ['rag-search'],
            response: {
                default: {...getListResSwaggerSchema(ragSearchItemSchema)}
            }
        }
    }, async function (request, reply) {
        return await ragSearch(request.reqParams.subject, request.reqParams.options)
    })
}
