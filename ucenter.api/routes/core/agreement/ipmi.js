/**
 * @fileOverview 协议管理接口
 * @author menglb
 * @module
 */

import * as agreementService from '../../../services/core/agreement.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import AgreementTypeEnum from '../../../daos/core/enum/AgreementTypeEnum.js'
import StatusEnum from '../../../daos/core/enum/StatusEnum.js'

export const autoPrefix = '/core/agreement/ipmi'

export default async function (fastify, opts) {
    const agreementSchema = {
        type: 'object',
        properties: {
            agreementCode: {type: 'string', description: '协议标识'},
            title: {type: 'string', description: '协议标题'},
            content: {type: 'string', description: '协议内容'},
            type: {type: 'number', enum: AgreementTypeEnum.toValues(), description: '协议类型'},
            version: {type: 'number', description: '协议版本号'},
            status: {type: 'number', enum: StatusEnum.toValues(), description: '状态'},
            effectiveTime: {type: 'string', format: 'date-time', description: '生效时间'},
        }
    }

    fastify.get('/detail', {
        schema: {
            description: '获取协议详情',
            summary: '获取协议详情',
            querystring: {
                type: 'object',
                properties: {
                    agreementCode: {type: 'string'}
                },
                required: ['agreementCode']
            },
            tags: ['agreement-ipmi'],
            response: {
                default: {...getResSwaggerSchema(agreementSchema)}
            }
        }
    }, async function (request, reply) {
        return await agreementService.getAgreementByCode(request.reqParams.agreementCode)
    })

    fastify.post('/list', {
        schema: {
            description: '获取协议列表',
            summary: '协议列表',
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
            tags: ['agreement-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(agreementSchema)}
            }
        }
    }, async function (request, reply) {
        return await agreementService.getAgreementList(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加协议',
            summary: '添加协议',
            body: agreementSchema,
            tags: ['agreement-ipmi'],
            response: {
                default: {...getResSwaggerSchema(agreementSchema)}
            }
        }
    }, async function (request, reply) {
        return await agreementService.addAgreement(request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改协议',
            summary: '修改协议',
            body: agreementSchema,
            tags: ['agreement-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        if (!request.reqParams.agreementCode) {
            return {code: 1, message: '协议标识不能为空'}
        }
        return await agreementService.updateAgreement(request.reqParams.agreementCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除协议',
            summary: '删除协议',
            body: {
                type: 'object',
                properties: {
                    agreementCode: {type: 'string'}
                },
                required: ['agreementCode']
            },
            tags: ['agreement-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await agreementService.deleteAgreement(request.reqParams.agreementCode)
    })
}
