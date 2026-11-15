/**
 * @fileOverview 远程技能管理相关的接口（管理端）
 * @author xianyang 2026/4/1
 * @module
 */

import * as grpcSkillService from '../../../services/core/grpcSkill.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/grpc-skill/ipmi'

const grpcSkillSchema = {$ref: 'fullParamModels#/properties/GrpcSkill'}

export function registerCommonRoutes(fastify, opts, tags = ['grpc-skill-ipmi']) {
    fastify.get('/detail', {
        schema: {
            description: '获取远程技能全部信息结构',
            summary: '获取远程技能的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    skillCode: {type: 'string'}
                },
                required: ['skillCode']
            },
            tags,
            response: {
                default: {
                    ...getResSwaggerSchema(grpcSkillSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await grpcSkillService.getGrpcSkill(request.reqParams.skillCode)
    })

    fastify.post('/update', {
        schema: {
            description: '修改远程技能',
            summary: '修改远程技能',
            body: grpcSkillSchema,
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await grpcSkillService.updateGrpcSkill(request.userInfo, request.reqParams.skillCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除远程技能',
            summary: '删除远程技能',
            body: {
                type: 'object',
                properties: {
                    skillCode: {
                        type: 'string'
                    },
                },
                required: ['skillCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await grpcSkillService.deleteGrpcSkill(request.userInfo, request.reqParams.skillCode)
    })

    fastify.post('/enable', {
        schema: {
            description: '启用远程技能',
            summary: '启用远程技能',
            body: {
                type: 'object',
                properties: {
                    skillCode: {
                        type: 'string'
                    },
                },
                required: ['skillCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await grpcSkillService.enableGrpcSkill(request.userInfo, request.reqParams.skillCode)
    })

    fastify.post('/disable', {
        schema: {
            description: '禁用远程技能',
            summary: '禁用远程技能',
            body: {
                type: 'object',
                properties: {
                    skillCode: {
                        type: 'string'
                    },
                },
                required: ['skillCode']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await grpcSkillService.disableGrpcSkill(request.userInfo, request.reqParams.skillCode)
    })

    /**
     * PR-E0.1 ②：审核入口（批准 / 驳回 / 撤销）。
     * 单独一个动作而不是塞进 `/update`，是为了让"改内容"与"改结论"在留痕里是两件事——
     * 塞进 update 的话，作者改一次描述就会在审计里冒充一次审核，谁批的、批的哪版都读不出来。
     */
    fastify.post('/review', {
        schema: {
            description: '审核远程技能（批准/驳回/撤销）',
            summary: '审核远程技能',
            body: {
                type: 'object',
                properties: {
                    skillCode: {type: 'string'},
                    to: {type: 'string', enum: ['approved', 'rejected', 'revoked'], description: '目标审核态'},
                    reason: {type: 'string', maxLength: 500, description: '理由（驳回/撤销必填）'},
                },
                required: ['skillCode', 'to']
            },
            tags,
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await grpcSkillService.reviewGrpcSkill(request.userInfo, request.reqParams.skillCode, {
            to: request.reqParams.to,
            reason: request.reqParams.reason || '',
        })
    })
}

export default async function (fastify, opts) {

    fastify.post('/list', {
        schema: {
            description: '获取远程技能列表',
            summary: '远程技能列表',
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
            tags: ['grpc-skill-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(grpcSkillSchema)}
            }
        }
    }, async function (request, reply) {
        return await grpcSkillService.getGrpcSkills(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    registerCommonRoutes(fastify, opts)
}