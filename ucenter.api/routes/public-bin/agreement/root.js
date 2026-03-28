/**
 * @fileOverview 协议公开接口
 * @author menglb
 * @module
 */

import * as agreementService from '../../../services/core/agreement.js'
import {getResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'

export default async function (fastify, opts) {
    const agreementSchema = {$ref: 'fullParamModels#/properties/Agreement'}
    fastify.get('/user', {
        schema: {
            description: '获取用户协议',
            summary: '获取用户协议',
            tags: ['public-bin'],
            response: {
                default: {...getResSwaggerSchema(agreementSchema)}
            }
        }
    }, async function (request, reply) {
        return await agreementService.getUserAgreement()
    })

    fastify.get('/privacy', {
        schema: {
            description: '获取隐私协议',
            summary: '获取隐私协议',
            tags: ['public-bin'],
            response: {
                default: {...getResSwaggerSchema(agreementSchema)}
            }
        }
    }, async function (request, reply) {
        return await agreementService.getPrivacyAgreement()
    })
}
