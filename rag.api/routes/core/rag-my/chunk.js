/**
 * @fileOverview 我的知识库材料分句相关的接口
 * @author xianyang 2025/7/4
 * @module
 */

import {registerCommonRoutes} from '../rag-info/ipmi-chunk.js'

export const autoPrefix = '/core/rag-my/chunk'

export default async function (fastify, opts) {

    registerCommonRoutes(fastify, opts, ['rag-my'])
}
