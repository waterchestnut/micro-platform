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
        let url = request.routeOptions.url
        if (url?.startsWith('/core/rag-my/list') || url?.startsWith('/core/rag-my/joined-list')) {
            /*我的知识库列表跳过校验*/
            return
        }
        if (url?.startsWith('/core/rag-my/application/apply')) {
            /*申请加入知识库跳过ragCode所有权校验*/
            return
        }

        let ragCode = request.reqParams?.ragCode
        if (!ragCode) {
            throw new Error('知识库不存在')
        }
        let ragInfo = await getRagInfo(ragCode)
        if (!ragInfo) {
            throw new Error('知识库不存在')
        }
        let isOwner = ragInfo.operator?.userCode === request.userInfo?.userCode
        let isAdmin = ragInfo.members?.some(m => m.userCode === request.userInfo?.userCode && m.memberType === 'admin')
        if (!isOwner && !isAdmin) {
            if (url?.startsWith('/core/rag-my/member/') || url?.startsWith('/core/rag-my/application/handle')) {
                throw new Error('无权限操作')
            }
        }
        if (!isOwner && !isAdmin && !ragInfo.members?.some(m => m.userCode === request.userInfo?.userCode)) {
            if (!url?.startsWith('/core/rag-my/detail')) {
                throw new Error('知识库不存在')
            }
        }
        request.ragInfo = ragInfo
    })
}
