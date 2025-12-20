/**
 * @fileOverview 部门管理相关的接口
 * @author xianyang
 * @module
 */

import * as departmentService from '../../../services/core/department.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/department/ipmi'

export default async function (fastify, opts) {
    const departmentSchema = {$ref: 'fullParamModels#/properties/Department'}

    fastify.post('/list', {
        schema: {
            description: '获取部门列表',
            summary: '部门列表',
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
            tags: ['department-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(departmentSchema)}
            }
        }
    }, async function (request, reply) {
        return await departmentService.getDepartments(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个部门',
            summary: '添加单个部门',
            body: departmentSchema,
            tags: ['department-ipmi'],
            response: {
                default: {...getResSwaggerSchema(departmentSchema)}
            }
        }
    }, async function (request, reply) {
        return await departmentService.addDepartment(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个部门',
            summary: '修改单个部门',
            body: departmentSchema,
            tags: ['department-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await departmentService.updateDepartment(request.reqParams.departmentCode, request.reqParams)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除部门',
            summary: '删除部门',
            body: {
                type: 'object',
                properties: {
                    departmentCode: {
                        type: 'string'
                    },
                },
                required: ['departmentCode']
            },
            tags: ['department-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await departmentService.deleteDepartment(request.reqParams.departmentCode)
    })
}
