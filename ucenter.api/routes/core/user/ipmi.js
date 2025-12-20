/**
 * @fileOverview 用户管理相关的接口
 * @author xianyang
 * @module
 */

import * as userInfoService from '../../../services/core/userInfo.js'
import {getPageListResSwaggerSchema, getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import {getUserByInfo} from "../../../services/core/userInfo.js";

export const autoPrefix = '/core/user/ipmi'

export default async function (fastify, opts) {
    const userSchema = {$ref: 'fullParamModels#/properties/UserInfo'}
    /*console.log(userSchema)*/

    fastify.get('/detail', {
        schema: {
            description: '获取用户全部信息结构',
            summary: '获取用户的详细信息',
            querystring: {
                type: 'object',
                properties: {
                    userCode: {type: 'string'}
                },
                required: ['userCode']
            },
            tags: ['user-ipmi'],
            response: {
                default: {
                    ...getResSwaggerSchema(userSchema)
                }
            }
        }
    }, async function (request, reply) {
        return await userInfoService.getUserDetail(request.reqParams.userCode)
    })

    fastify.post('/list', {
        schema: {
            description: '获取用户列表',
            summary: '用户列表',
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
            tags: ['user-ipmi'],
            response: {
                default: {...getPageListResSwaggerSchema(userSchema)}
            }
        }
    }, async function (request, reply) {
        return await userInfoService.getUserList(request.reqParams.filter, request.reqParams.pageIndex, request.reqParams.pageSize, request.reqParams.options)
    })

    fastify.post('/add', {
        schema: {
            description: '添加单个用户',
            summary: '添加单个用户',
            body: userSchema,
            tags: ['user-ipmi'],
            response: {
                default: {...getResSwaggerSchema(userSchema)}
            }
        }
    }, async function (request, reply) {
        return await userInfoService.addUserInfo(request.userInfo, request.reqParams)
    })

    fastify.post('/update', {
        schema: {
            description: '修改单个用户',
            summary: '修改单个用户',
            body: userSchema,
            tags: ['user-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await userInfoService.updateUserInfo(request.reqParams.userCode, request.reqParams, 1)
    })

    fastify.post('/delete', {
        schema: {
            description: '删除用户',
            summary: '删除用户',
            body: {
                type: 'object',
                properties: {
                    userCode: {
                        type: 'string'
                    },
                },
                required: ['userCode']
            },
            tags: ['user-ipmi'],
            response: {
                default: {...getResSwaggerSchema()}
            }
        }
    }, async function (request, reply) {
        return await userInfoService.deleteUserInfo(request.reqParams.userCode)
    })
    // 新增：更新用户角色的路由
  fastify.post('/updateRole', {
        schema: {
            description: '更新用户角色',
            summary: '更新用户的 groupCodes（角色数组）',
            body: {
                type: 'object',
                required: ['userCode', 'roles'],
                properties: {
                    userCode: { type: 'string' },
                    roles: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '用户的新角色列表'
                    },
                },
            },
            response: {
                200: {
                    description: '成功更新角色',
                    type: 'object',
                    properties: {
                        code: { type: 'integer' },
                        msg: { type: 'string' },
                    },
                },
                default: {
                    description: '请求失败',
                    type: 'object',
                    properties: {
                        code: { type: 'integer' },
                        msg: { type: 'string' },
                    },
                },
            },
        },
        handler: async (request, reply) => {
            const { userCode, roles } = request.body;
            try {
                const result = await userInfoService.updateUserRole(userCode, roles);
                if (result.code === 0) {
                    return reply.code(200).send({ code: 0, msg: '角色更新成功' });
                } else {
                    return reply.code(400).send({ code: result.code || -1, msg: result.msg || '角色更新失败' });
                }
            } catch (err) {
                return reply.code(500).send({ code: -1, msg: err.message || '角色更新失败' });
            }
        },
    });

}
