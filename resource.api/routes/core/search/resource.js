/**
 * @fileOverview es检索相关的接口
 * @module
 */

import {getListResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import resourceSearch from '../../../services/search/resource/index.js'
import {mergeSearch} from '../../../services/search/index.js'

export const autoPrefix = '/core/search/resource'

export default async function (fastify, opts) {

    fastify.post('/all', {
        schema: {
            description: '从ES索引库检索资源',
            summary: '资源检索',
            tags: ['resource-search'],
            response: {}
        }
    }, async function (req, reply) {
        return await resourceSearch.search(req.reqParams.paramList, req.reqParams.sort, req.reqParams.pageIndex, req.reqParams.pageSize, {
            ...req.reqParams.options, hiddeHighlight: true
        })
    })

    fastify.post('/agg', {
        schema: {
            description: '从索引库对资源聚合统计',
            summary: '资源聚合统计',
            tags: ['resource-search'],
            response: {}
        }
    }, async function (req, reply) {
        return await resourceSearch.agg(req.reqParams.paramList, {
            ...req.reqParams.options, hiddeHighlight: true
        }, req.reqParams.filter, req.reqParams.aggParams)
    })

    fastify.post('/merge', {
        schema: {
            description: '从多种源检索资源',
            summary: '资源检索',
            tags: ['resource-search'],
            response: {}
        }
    }, async function (req, reply) {
        return await mergeSearch(req.reqParams.query, req.reqParams.filter, req.reqParams.pageIndex, req.reqParams.pageSize, req.reqParams.options, req.reqParams.sort)
    })
}
