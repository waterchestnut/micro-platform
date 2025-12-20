/**
 * @fileOverview 统一格式化响应的数据
 * @author xianyang
 * @module plugins/format-reply
 */

import fp from 'fastify-plugin'
import * as tools from '../tools/index.js'
import {getResSwaggerSchema} from '../daos/swaggerSchema/responseHandler.js'
import localize_zh from 'ajv-i18n/localize/zh/index.js'

export default fp(async function (fastify, opts) {
    fastify.addHook('preSerialization', async (request, reply, payload) => {
        if (request.routeOptions.url?.startsWith('/documentation')) {
            return payload
        }

        let newPayload = (payload?.data || tools.isExist(payload?.code) || tools.isExist(payload?.statusCode)) ? payload : {data: payload}
        if (!tools.isExist(payload?.statusCode)) {
            newPayload.statusCode = 200
        }
        if (!tools.isExist(payload?.code)) {
            newPayload.code = 0
        }
        return newPayload
    })

    fastify.setErrorHandler(function (error, request, reply) {
        let msg = error.message
        if (error.validation) {
            localize_zh(error.validation)
            /*console.log(error)*/
            msg = error.validation.map(_ => _.message).join('\n')
        }
        request.log.error(error)
        reply.status(error.statusCode || 500).send({
            msg,
            errorLevel: 'error',
            statusCode: error.statusCode || 500,
            code: -1
        })
    })

    fastify.setNotFoundHandler(function (request, reply) {
        reply.status(404).send({
            msg: `路由 ${request.method}:${request.url} 不存在`,
            statusCode: 404,
            errorLevel: 'error',
            code: -1
        })
    })
})

export function getDefaultResponseSchema(dataSchema = undefined) {
    let data = {
        type: 'object',
        nullable: true,
        description: '业务处理的数据'
    }
    if (dataSchema) {
        data.properties = dataSchema
    }
    return getResSwaggerSchema(data)
}
