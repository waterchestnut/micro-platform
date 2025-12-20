/**
 * @fileOverview 我的知识库材料分段相关的接口
 * @author xianyang 2025/7/4
 * @module
 */

import {registerCommonRoutes} from '../rag-info/ipmi-segment.js'

export const autoPrefix = '/core/rag-my/segment'

export default async function (fastify, opts) {

    registerCommonRoutes(fastify, opts, ['rag-my'])
}
