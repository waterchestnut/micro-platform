/**
 * @fileOverview 知识库成员管理相关的接口
 * @module
 */

import * as ragInfoService from '../../../services/core/ragInfo.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/rag-my'

export default async function (fastify, opts) {

    fastify.post('/member/add', {
        schema: {
            description: '添加知识库成员',
            summary: '添加知识库成员',
            body: {
                type: 'object',
                properties: {
                    ragCode: {type: 'string'},
                    userCode: {type: 'string'},
                    realName: {type: 'string'},
                    memberType: {type: 'string', enum: ['admin', 'user']},
                },
                required: ['ragCode', 'userCode', 'realName']
            },
            tags: ['rag-my'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.addMember(request.userInfo, request.reqParams.ragCode, request.reqParams.userCode, request.reqParams.realName, request.reqParams.memberType)
    })

    fastify.post('/member/remove', {
        schema: {
            description: '移除知识库成员',
            summary: '移除知识库成员',
            body: {
                type: 'object',
                properties: {
                    ragCode: {type: 'string'},
                    userCode: {type: 'string'},
                },
                required: ['ragCode', 'userCode']
            },
            tags: ['rag-my'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.removeMember(request.userInfo, request.reqParams.ragCode, request.reqParams.userCode)
    })

    fastify.post('/member/update-type', {
        schema: {
            description: '更新成员角色',
            summary: '更新成员角色',
            body: {
                type: 'object',
                properties: {
                    ragCode: {type: 'string'},
                    userCode: {type: 'string'},
                    memberType: {type: 'string', enum: ['admin', 'user']},
                },
                required: ['ragCode', 'userCode', 'memberType']
            },
            tags: ['rag-my'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.updateMemberType(request.userInfo, request.reqParams.ragCode, request.reqParams.userCode, request.reqParams.memberType)
    })

    fastify.post('/application/apply', {
        schema: {
            description: '申请加入知识库',
            summary: '申请加入知识库',
            body: {
                type: 'object',
                properties: {
                    ragCode: {type: 'string'},
                },
                required: ['ragCode']
            },
            tags: ['rag-my'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.applyJoin(request.userInfo, request.reqParams.ragCode)
    })

    fastify.post('/application/handle', {
        schema: {
            description: '处理加入申请',
            summary: '处理加入申请（同意或拒绝）',
            body: {
                type: 'object',
                properties: {
                    ragCode: {type: 'string'},
                    applicationCode: {type: 'string'},
                    status: {type: 'number', enum: [1, 2]},
                },
                required: ['ragCode', 'applicationCode', 'status']
            },
            tags: ['rag-my'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await ragInfoService.handleApplication(request.userInfo, request.reqParams.ragCode, request.reqParams.applicationCode, request.reqParams.status)
    })
}
