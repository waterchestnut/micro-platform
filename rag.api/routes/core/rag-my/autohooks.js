/**
 * @fileOverview 检查请求中是否包含有效ragCode，以及该知识库是否为当前登录用户所创建
 * @author xianyang
 * @module
 */

import {getRagInfo} from '../../../services/core/ragInfo.js'

const tools = rag.tools
const logger = rag.logger

const readRoutes = ['/core/rag-my/detail', '/core/rag-my/material/list', '/core/rag-my/material/detail', '/core/rag-my/segment/list', '/core/rag-my/segment/detail', '/core/rag-my/chunk/list', '/core/rag-my/chunk/detail', '/core/rag-my/log/list']
const writeRoutes = ['/core/rag-my/update', '/core/rag-my/material/add', '/core/rag-my/material/update', '/core/rag-my/material/delete', '/core/rag-my/material/enable', '/core/rag-my/material/disable', '/core/rag-my/segment/add', '/core/rag-my/segment/update', '/core/rag-my/segment/delete', '/core/rag-my/segment/enable', '/core/rag-my/segment/disable', '/core/rag-my/chunk/add', '/core/rag-my/chunk/update', '/core/rag-my/chunk/delete', '/core/rag-my/chunk/enable', '/core/rag-my/chunk/disable']
const ownerRoutes = ['/core/rag-my/delete', '/core/rag-my/enable', '/core/rag-my/disable']

export default async function (fastify, opts) {
    fastify.addHook('preValidation', async (request, reply) => {
        let url = request.routeOptions.url
        if (url?.startsWith('/core/rag-my/list') || url?.startsWith('/core/rag-my/joined-list')) {
            return
        }
        if (url?.startsWith('/core/rag-my/application/apply')) {
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

        let userCode = request.userInfo?.userCode
        let isOwner = ragInfo.operator?.userCode === userCode
        let member = ragInfo.members?.find(m => m.userCode === userCode)
        let isAdmin = member?.memberType === 'admin'
        let isMember = !!member
        let hasPendingApplication = ragInfo.applications?.some(a => a.userCode === userCode && a.status === 0)

        if (ownerRoutes.some(r => url?.startsWith(r))) {
            if (!isOwner) {
                throw new Error('无权限操作，仅所有者可执行此操作')
            }
        } else if (url?.startsWith('/core/rag-my/member/quit')) {
            if (!isMember) {
                throw new Error('您不是该知识库的成员')
            }
        } else if (writeRoutes.some(r => url?.startsWith(r)) || url?.startsWith('/core/rag-my/member/') || url?.startsWith('/core/rag-my/application/handle')) {
            if (!isOwner && !isAdmin) {
                throw new Error('无权限操作，仅管理员或所有者可执行此操作')
            }
        } else if (readRoutes.some(r => url?.startsWith(r))) {
            if (!isMember && !hasPendingApplication) {
                throw new Error('无权限访问该知识库')
            }
        } else {
            if (!isOwner && !isAdmin && !isMember) {
                throw new Error('知识库不存在')
            }
        }

        request.ragInfo = ragInfo
    })
}
