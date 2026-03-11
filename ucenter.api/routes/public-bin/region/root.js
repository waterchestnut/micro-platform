import * as regionService from '../../../services/core/region.js'
import {getListResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export default async function (fastify, opts) {
    const regionSchema = {$ref: 'fullParamModels#/properties/Region'}

    fastify.get('/all', {
        schema: {
            description: '获取所有的区域列表',
            summary: '获取区域列表',
            tags: ['public-bin'],
            querystring: {
                type: 'object',
                properties: {
                    maxLevel: {type: 'number', default: 0, description: '最大层级'},
                },
            },
            response: {
                default: {
                    ...getListResSwaggerSchema(regionSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await regionService.getAllRegions(request.reqParams.maxLevel)
    })

    fastify.get('/tree', {
        schema: {
            description: '获取区域树形结构',
            summary: '获取区域树形结构',
            tags: ['public-bin'],
            querystring: {
                type: 'object',
                properties: {
                    parentCode: {type: 'string', default: '', description: '父级区域标识'},
                    maxLevel: {type: 'number', default: 0, description: '最大层级'},
                },
            },
        }
    }, async function (request, reply) {
        return await regionService.getTreeRegions(request.reqParams.parentCode, request.reqParams.maxLevel)
    })
}
