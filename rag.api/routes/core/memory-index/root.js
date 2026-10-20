/**
 * @fileOverview 长期记忆向量索引的接口
 * @author xianyang 2026-10-18
 * @module
 * @description 仅供内网服务间调用（llm.api → rag.api，见决策 D5）。
 * rag.api 与网关一样信任注入的 `user-info`，因此调用方必须自带该头；
 * 写与删都以 `request.userInfo.userCode` 为准，不接受请求体自报身份，避免越权写别人的记忆。
 */

import {upsertMemoryIndex, deleteMemoryIndex, searchMemoryIndex} from '../../../services/core/memoryIndex.js'

export const autoPrefix = '/core/memory-index'

export default async function (fastify, opts) {

    fastify.post('/upsert', {
        schema: {
            description: '写入或更新记忆向量（按 memoryCode 幂等覆盖）',
            summary: '记忆向量化写入',
            body: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        maxItems: 200,
                        items: {
                            type: 'object',
                            properties: {
                                memoryCode: {type: 'string', maxLength: 128},
                                text: {type: 'string', maxLength: 8000},
                                kind: {type: 'string', maxLength: 32},
                                topic: {type: 'string', maxLength: 128},
                                state: {type: 'string', enum: ['active', 'review', 'superseded', 'retired']},
                                workspaceId: {type: ['string', 'null'], maxLength: 128},
                                insertTime: {type: 'number'},
                            },
                            required: ['memoryCode', 'text'],
                        },
                    },
                },
                required: ['items'],
            },
            tags: ['memory-index'],
        },
    }, async function (request, reply) {
        const userCode = request.userInfo?.userCode
        if (!userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const items = (request.reqParams.items || []).map(it => ({
            ...it,
            /** 身份以服务端解析为准，请求体里的同名字段一律覆盖 */
            userCode,
            channel: it.channel || request.reqParams.channel || 'unknown',
        }))
        return await upsertMemoryIndex({items})
    })

    fastify.post('/delete', {
        schema: {
            description: '按记忆标识删除向量（记忆退役或被替代时调用）',
            summary: '删除记忆向量',
            body: {
                type: 'object',
                properties: {
                    memoryCodes: {type: 'array', maxItems: 200, items: {type: 'string'}},
                    channel: {type: 'string', maxLength: 64},
                },
                required: ['memoryCodes'],
            },
            tags: ['memory-index'],
        },
    }, async function (request, reply) {
        const userCode = request.userInfo?.userCode
        if (!userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        return await deleteMemoryIndex({memoryCodes: request.reqParams.memoryCodes, userCode, channel: request.reqParams.channel})
    })

    fastify.post('/search', {
        schema: {
            description: '按语义检索当前用户某频道的记忆向量，返回标识与文本副本',
            summary: '记忆语义检索',
            body: {
                type: 'object',
                properties: {
                    text: {type: 'string', description: '查询文本'},
                    channel: {type: 'string', description: '频道标识'},
                    workspaceId: {type: ['string', 'null'], description: '沙箱工作区标识'},
                    states: {type: 'array', items: {type: 'string'}, description: '允许的生命周期，默认只 active'},
                    topK: {type: 'number', minimum: 1, maximum: 100},
                    minSimilarity: {type: 'number', minimum: 0, maximum: 1},
                },
                required: ['text', 'channel'],
            },
            tags: ['memory-index'],
        },
    }, async function (request, reply) {
        const userCode = request.userInfo?.userCode
        if (!userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const p = request.reqParams
        return await searchMemoryIndex({
            text: p.text,
            userCode,
            channel: p.channel,
            workspaceId: p.workspaceId || null,
            states: p.states,
            topK: p.topK,
            minSimilarity: p.minSimilarity,
        })
    })
}
