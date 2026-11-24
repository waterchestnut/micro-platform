/**
 * @fileOverview 写面 handoff 确认链的用户端接口（console ai-confirm 页调）
 * @module routes/core/skill-handoff
 * @description
 * 判序纪律同 /answer（chat/root.js）：token 即凭证、坏 token 一律拒不因分支泄露差异、
 * 身份取 request.userInfo（鉴权中间件注入），token 内 userCode 必须与之一致（转发兑不动）。
 */

import {previewHandoff, redeemHandoff} from '../../../services/core/skill/skillHandoff.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export const autoPrefix = '/core/skill-handoff'

const tokenOnlySchema = {
    type: 'object',
    required: ['token'],
    properties: {token: {type: 'string', description: 'handoff 一次性确认 token（提案时签发）'}},
}

/** 身份守卫（同 chat/agentTask/artifact 纪律：缺身份 401，绝不裸取 userInfo 冒成 500） */
function requireUser(request) {
    if (!request.userInfo?.userCode) {
        const err = new Error('缺少有效的用户身份（user-info）')
        err.statusCode = 401
        throw err
    }
    return request.userInfo
}

export default async function (fastify, opts) {
    fastify.post('/preview', {
        schema: {
            description: '校验一次性确认 token 并回显 AI 组装的写参数（不落库、不消费）',
            summary: '写面 handoff 预览回显',
            body: tokenOnlySchema,
            tags: ['skill-handoff'],
            response: {default: {...getResSwaggerSchema()}},
        },
    }, async function (request, reply) {
        const ui = requireUser(request)
        const ret = await previewHandoff({
            token: request.reqParams.token,
            callerUserCode: ui.userCode,
        })
        if (!ret.ok) {
            return {code: -1, msg: `确认链接无效或已过期（${ret.reason}）`, data: {reason: ret.reason}}
        }
        return {code: 0, msg: '', data: {skillName: ret.skillName, commandName: ret.commandName, params: ret.params}}
    })

    fastify.post('/redeem', {
        schema: {
            description: '兑换一次性确认 token：此刻才落库建草稿，返回深链目标码',
            summary: '写面 handoff 兑换执行',
            body: tokenOnlySchema,
            tags: ['skill-handoff'],
            response: {default: {...getResSwaggerSchema()}},
        },
    }, async function (request, reply) {
        const ui = requireUser(request)
        const ret = await redeemHandoff({
            token: request.reqParams.token,
            callerUserCode: ui.userCode,
            curUserInfo: ui,
        })
        if (!ret.ok) {
            return {code: -1, msg: `确认执行失败（${ret.reason}）`, data: {reason: ret.reason, detail: (ret.detail || '').slice(0, 120)}}
        }
        return {code: 0, msg: '', data: {researchCode: ret.researchCode, result: ret.result}}
    })
}
