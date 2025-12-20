/**
 * @fileOverview 检查请求中是否包含有效ragCode，以及该知识库是否为当前登录用户所创建
 * @author xianyang
 * @module
 */

import {getRagInfo} from '../../../services/core/ragInfo.js'

const tools = rag.tools
const logger = rag.logger

export default async function (fastify, opts) {
    fastify.addHook('preValidation', async (request, reply) => {
        /*console.log(request.hostname, request.routeOptions)*/
        if (request.routeOptions.url?.startsWith('/core/rag-my/list')) {
            /*我的知识库列表跳过校验*/
            return
        }

        let ragCode = request.reqParams?.ragCode
        if (!ragCode) {
            throw new Error('知识库不存在')
        }
        let ragInfo = await getRagInfo(ragCode)
        if (ragInfo?.operator?.userCode !== request.userInfo?.userCode) {
            throw new Error('知识库不存在')
        }
        request.ragInfo = ragInfo
    })
}
