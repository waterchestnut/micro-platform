/**
 * @fileOverview es日志检索相关的接口
 * @module
 */

import {getListResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import msgSearch from '../../../services/search/msg/index.js'

export const autoPrefix = '/core/search/msg'

export default async function (fastify, opts) {

    fastify.post('/all', {
        schema: {
            description: '从ES索引库检索日志',
            summary: '日志检索',
            tags: ['msg-search'],
            response: {}
        }
    }, async function (req, reply) {
        return await msgSearch.search(req.reqParams.paramList, req.reqParams.sort, req.reqParams.pageIndex, req.reqParams.pageSize, {
            ...req.reqParams.options, hiddeHighlight: true
        })
    })

    fastify.post('/agg', {
        schema: {
            description: '从索引库对日志聚合统计',
            summary: '日志聚合统计',
            tags: ['msg-search'],
            response: {}
        }
    }, async function (req, reply) {
        return await msgSearch.agg(req.reqParams.paramList, {
            ...req.reqParams.options, hiddeHighlight: true
        }, req.reqParams.filter, req.reqParams.aggParams)
    })
}
