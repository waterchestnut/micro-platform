/**
 * @fileOverview 远程技能管理相关的接口
 * @author xianyang 2026/4/1
 * @module
 */

import * as grpcSkillService from '../../../services/core/grpcSkill.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

const grpcSkillSchema = {$ref: 'fullParamModels#/properties/GrpcSkill'}

export default async function (fastify, opts) {
    const grpcSkillSchema = {$ref: 'fullParamModels#/properties/GrpcSkill'}

    fastify.post('/add', {
        schema: {
            description: '添加单个远程技能',
            summary: '添加单个远程技能',
            body: grpcSkillSchema,
            tags: ['grpc-skill'],
            response: {
                default: {...getResSwaggerSchema(grpcSkillSchema)}
            }
        }
    }, async function (request, reply) {
        return await grpcSkillService.addGrpcSkill(request.userInfo, request.reqParams)
    })
}