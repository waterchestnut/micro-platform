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

        /**
         * 三种"不行"以前全压成 `throw new Error('技能不存在')`，于是对外一律 HTTP 500
         * （`plugins/format-reply.js:36` 取的是 `error.statusCode || 500`）。
         * 本仓对拒绝口径是**成文纪律**，不是偏好：`test/routes/messageAccess.test.js:46` 断言
         * "越权应是 403，不是 500"，`services/core/message.js:77-81` 也引了 §2D.2 同一条。
         * 500 的代价有两层：网关侧把它记成服务端故障（掩盖真实的越权尝试），
         * 前端只能显示"系统异常"，用户永远不知道自己其实是动了别人的技能。
         */
        const userCode = request.userInfo?.userCode
        if (!userCode) {
            const err = new Error('缺少有效的用户身份（userCode）')
            err.statusCode = 401
            throw err
        }
        let skillCode = request.reqParams?.skillCode
        if (!skillCode) {
            const err = new Error('缺少技能标识')
            err.statusCode = 400
            throw err
        }
        let grpcSkill = await getGrpcSkill(skillCode)
        if (!grpcSkill || grpcSkill.operator?.userCode !== userCode) {
            /**
             * "不存在"与"不是你的"给**同一个 403、同一句文案**：这是刻意的防枚举，
             * 与 `services/core/u2uChat.js:284-286` 那条同口径（那里写得更直白——"文案不区分公司不存在/不可联系"）。
             * 如果这里给 404/403 两种码，攻击者就能用状态码差把 skillCode 是否存在读出来。
             */
            const err = new Error('技能不存在')
            err.statusCode = 403
            throw err
        }
        request.grpcSkill = grpcSkill
    })
}
