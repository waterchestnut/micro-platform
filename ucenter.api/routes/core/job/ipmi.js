/**
 * @fileOverview 职位管理相关的接口
 * @author xianyang
 * @module
 */

import * as jobService from '../../../services/core/job.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/job/ipmi'

export default async function (fastify, opts) {
    const jobSchema = {$ref: 'fullParamModels#/properties/Job'}

    fastify.post('/list', {
        schema: {
            description: '获取职位列表',
            summary: '职位列表',
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
            tags: ['job-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(jobSchema)}
            }
        }
    }, async function (request, reply) {
        return await jobService.getJobs(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个职位',
            summary: '添加单个职位',
            body: jobSchema,
            tags: ['job-ipmi'],
            response: {
                default: {...getResSwaggerSchema(jobSchema)}
            }
        }
    }, async function (request, reply) {
        return await jobService.addJob(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个职位',
            summary: '修改单个职位',
            body: jobSchema,
            tags: ['job-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await jobService.updateJob(request.reqParams.jobCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除职位',
            summary: '删除职位',
            body: {
                type: 'object',
                properties: {
                    jobCode: {
                        type: 'string'
                    },
                },
                required: ['jobCode']
            },
            tags: ['job-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await jobService.deleteJob(request.reqParams.jobCode)
    })
}
