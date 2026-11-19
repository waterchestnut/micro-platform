import {listArtifactsForUser, readArtifactForUser} from '../../../services/core/artifact/artifactQuery.js'

/**
 * 产物查询面（Agent UI 刀 B 服务端前置）：工作区列表与读回。
 * 可见性=会话成员制（artifactQuery 复用 resolveMessageScope 单源）；
 * 身份校验不能省（D57 同规：内部路径不是已鉴权）。
 */
export default async function (fastify, opts) {

    fastify.post('/list', {
        schema: {
            description: '按会话列产物（可见性=会话成员制，与 /core/message/list 同口径）',
            summary: '会话产物列表',
            body: {
                type: 'object',
                required: ['conversationCode'],
                properties: {
                    conversationCode: {type: 'string', minLength: 1, maxLength: 128},
                    limit: {type: 'number', description: '缺省 50，上限 200'},
                },
            },
            tags: ['llm'],
            response: {},
        },
    }, async function (request, reply) {
        if (!request.userInfo?.userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const ret = await listArtifactsForUser({
            conversationCode: String(request.reqParams?.conversationCode || ''),
            userCode: request.userInfo.userCode,
            limit: request.reqParams?.limit,
        })
        if (ret.deny === 'not-member') {
            const err = new Error('无权访问该会话')
            err.statusCode = 403
            throw err
        }
        if (ret.deny) {
            const err = ret.deny === 'no-user' ? Object.assign(new Error('缺少有效的用户身份'), {statusCode: 401}) : Object.assign(new Error('缺少会话标识'), {statusCode: 400})
            throw err
        }
        // 手写信封（agentTask 路由同例）：拒法体 {success:false,error} 不许被 format-reply 猜测拆层
        return {statusCode: 200, code: 0, data: ret}
    })

    fastify.post('/read', {
        schema: {
            description: '分页读回产物正文（成员制校验先行；状态闸/字节上限沿用 read_artifact 执行体单源）',
            summary: '产物读回',
            body: {
                type: 'object',
                required: ['artifactCode'],
                properties: {
                    artifactCode: {type: 'string', minLength: 1, maxLength: 128},
                    offset: {type: 'number', description: '字符偏移，缺省 0'},
                    limit: {type: 'number', description: '字符数，缺省走 artifactConfig 预算'},
                },
            },
            tags: ['llm'],
            response: {},
        },
    }, async function (request, reply) {
        if (!request.userInfo?.userCode) {
            const err = new Error('缺少有效的用户身份（user-info）')
            err.statusCode = 401
            throw err
        }
        const ret = await readArtifactForUser({
            artifactCode: String(request.reqParams?.artifactCode || ''),
            userCode: request.userInfo.userCode,
            realName: request.userInfo.realName || '',
            offset: request.reqParams?.offset,
            limit: request.reqParams?.limit,
        })
        if (ret.deny === 'not-member') {
            const err = new Error('无权访问该产物所属会话')
            err.statusCode = 403
            throw err
        }
        if (ret.error === 'not-found') {
            const err = new Error('产物不存在')
            err.statusCode = 404
            throw err
        }
        return {statusCode: 200, code: 0, data: ret}
    })
}
