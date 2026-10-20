import {
    getAtom, listAtoms, recallPreview, saveMemory,
    searchArchive, updateProfile, getProfile, retireAtom,
} from '../../../services/core/memory/api.js'

export const autoPrefix = '/core/memory'

/**
 * @fileOverview 大模型长期记忆的对外接口
 * @description 全部以当前登录用户的 userCode 为边界，只能读写自己的记忆。
 * 频道需先在 conf/llmChannel.js 的 memory 段开启，否则返回 403。
 */
export default async function (fastify, opts) {

    fastify.post('/atoms', {
        schema: {
            description: '按命名空间分页列出生效中的记忆原子，不含发给模型的提示词与工具原文',
            summary: '记忆列表',
            body: {
                type: 'object',
                properties: {
                    filter: {
                        type: 'object',
                        properties: {
                            channel: {type: 'string', description: '频道标识，必填'},
                            states: {type: 'array', items: {type: 'string'}, description: '默认只返回 active'},
                            topic: {type: 'string'},
                            kind: {type: 'string'},
                            keyword: {type: 'string', description: '正文关键字，按字面量匹配'},
                        },
                    },
                    pageIndex: {type: 'number'},
                    pageSize: {type: 'number'},
                    options: {type: 'object'},
                },
            },
            tags: ['memory'],
        },
    }, async function (request, reply) {
        const p = request.reqParams
        return await listAtoms(request.userInfo, p.filter, p.pageIndex, p.pageSize, p.options)
    })

    fastify.get('/atom/detail', {
        schema: {
            description: '取一条记忆的正文与全部证据',
            summary: '记忆详情',
            querystring: {
                type: 'object',
                properties: {
                    atomCode: {type: 'string'},
                    channel: {type: 'string'},
                },
                required: ['atomCode', 'channel'],
            },
            tags: ['memory'],
        },
    }, async function (request, reply) {
        return await getAtom(request.userInfo, request.reqParams.atomCode, request.reqParams.channel)
    })

    fastify.post('/atom/retire', {
        schema: {
            description: '退役一条记忆（软退役并写变更日志，可申诉可回溯）',
            summary: '退役记忆',
            body: {
                type: 'object',
                properties: {
                    atomCode: {type: 'string'},
                    channel: {type: 'string'},
                    reason: {type: 'string'},
                },
                required: ['atomCode', 'channel'],
            },
            tags: ['memory'],
        },
    }, async function (request, reply) {
        const p = request.reqParams
        return await retireAtom(request.userInfo, p.atomCode, p.channel, p.reason)
    })

    fastify.post('/save', {
        schema: {
            description: '手动保存一条记忆，不经模型抽取、立即可被召回',
            summary: '保存记忆',
            body: {
                type: 'object',
                properties: {
                    channel: {type: 'string'},
                    content: {type: 'string'},
                    topic: {type: 'string'},
                    conversationCode: {type: 'string'},
                    messageCode: {type: 'string'},
                },
                required: ['channel', 'content'],
            },
            tags: ['memory'],
        },
    }, async function (request, reply) {
        const p = request.reqParams
        return await saveMemory(request.userInfo, p)
    })

    fastify.get('/profile', {
        schema: {
            description: '读取 owner 维护的用户画像与强记忆文档',
            summary: '记忆画像',
            querystring: {
                type: 'object',
                properties: {channel: {type: 'string'}},
                required: ['channel'],
            },
            tags: ['memory'],
        },
    }, async function (request, reply) {
        return await getProfile(request.userInfo, request.reqParams.channel)
    })

    fastify.post('/profile/update', {
        schema: {
            description: '改写 owner 文档；字段不传表示不修改，版本号递增。模型侧工具无权改写此处内容',
            summary: '改写记忆画像',
            body: {
                type: 'object',
                properties: {
                    channel: {type: 'string'},
                    userDoc: {type: 'string', maxLength: 20000},
                    memoryDoc: {type: 'string', maxLength: 20000},
                },
                required: ['channel'],
            },
            tags: ['memory'],
        },
    }, async function (request, reply) {
        const p = request.reqParams
        return await updateProfile(request.userInfo, p)
    })

    fastify.post('/search', {
        schema: {
            description: '检索已归档的对话原文，与事实召回是两套 API',
            summary: '记忆归档检索',
            body: {
                type: 'object',
                properties: {
                    channel: {type: 'string'},
                    keyword: {type: 'string'},
                    pageIndex: {type: 'number'},
                    pageSize: {type: 'number'},
                    options: {type: 'object'},
                },
                required: ['channel', 'keyword'],
            },
            tags: ['memory'],
        },
    }, async function (request, reply) {
        const p = request.reqParams
        return await searchArchive(request.userInfo, p)
    })

    fastify.post('/recall-preview', {
        schema: {
            description: '把召回管线各阶段中间结果吐出来，用于调试与放量前验收',
            summary: '召回预览',
            body: {
                type: 'object',
                properties: {
                    channel: {type: 'string'},
                    query: {type: 'string'},
                    workspaceId: {type: 'string'},
                },
                required: ['channel', 'query'],
            },
            tags: ['memory'],
        },
    }, async function (request, reply) {
        const p = request.reqParams
        return await recallPreview(request.userInfo, p)
    })

    fastify.get('/extractor-health', {
        schema: {
            description: '抽取消费者健康探针：心跳、消费组状态、成员数、分区 lag 与判定（§6.3 交付物，全部是计数）',
            summary: '抽取消费者健康检查',
            tags: ['memory'],
        },
    }, async function (request, reply) {
        const {getExtractorHealth} = await import('../../../services/core/memory/health.js')
        return await getExtractorHealth()
    })
}
