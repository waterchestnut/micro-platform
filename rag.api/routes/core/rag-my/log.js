/**
 * @fileOverview 知识库操作日志相关的接口（成员）
 * @module
 */

import {registerCommonRoutes} from '../rag-info/ipmi-log.js'

export const autoPrefix = '/core/rag-my/log'

export default async function (fastify, opts) {
    registerCommonRoutes(fastify, opts, ['rag-my'])
}
