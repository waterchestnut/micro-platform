/**
 * @fileOverview 我的远程技能相关的接口（用户端）
 * @author xianyang 2026/4/1
 * @module
 */

import * as grpcSkillService from '../../../services/core/grpcSkill.js'
import {registerCommonRoutes} from '../grpc-skill/ipmi.js'
import {getPageListResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/grpc-skill-my'

export default async function (fastify, opts) {
    const grpcSkillSchema = {$ref: 'fullParamModels#/properties/GrpcSkill'}

    fastify.post('/list', {
        schema: {
            description: '获取我创建的远程技能列表',
            summary: '我的远程技能列表',
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
            tags: ['grpc-skill-my'],
            response: {
                default: {...getPageListResSwaggerSchema(grpcSkillSchema)}
            }
        }
    }, async function (request, reply) {
        return await grpcSkillService.getGrpcSkills({
            ...request.reqParams.filter,
            operatorUserCode: request.userInfo.userCode
        }, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    registerCommonRoutes(fastify, opts, ['grpc-skill-my'])
}
