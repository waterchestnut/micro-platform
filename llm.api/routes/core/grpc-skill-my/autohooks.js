/**
 * @fileOverview 检查请求中是否包含有效skillCode，以及该技能是否为当前登录用户所创建
 * @author xianyang 2026/4/1
 * @module
 */

import {getGrpcSkill} from '../../../services/core/grpcSkill.js'

const tools = llm.tools
const logger = llm.logger

export default async function (fastify, opts) {
    fastify.addHook('preValidation', async (request, reply) => {
        if (request.routeOptions.url?.startsWith('/core/grpc-skill-my/list')) {
            /*我的远程技能列表跳过校验*/
            return
        }

        let skillCode = request.reqParams?.skillCode
        if (!skillCode) {
            throw new Error('技能不存在')
        }
        let grpcSkill = await getGrpcSkill(skillCode)
        if (grpcSkill?.operator?.userCode !== request.userInfo?.userCode) {
            throw new Error('技能不存在')
        }
        request.grpcSkill = grpcSkill
    })
}
