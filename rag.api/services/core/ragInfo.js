/**
 * @fileOverview 知识库管理相关的业务操作
 * @author xianyang
 * @module
 */

import ragInfoDac from '../../daos/core/dac/ragInfoDac.js'
import retSchema from '../../daos/retSchema.js'
import {checkCodeField} from '../../tools/check.js'
import {addLog} from './ragOperationLog.js'

const tools = rag.tools
const logger = rag.logger
const config = rag.config

/**
 * @description 获取知识库列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 知识库数组}
 */
export async function getRagInfos(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {updateTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return ragInfoDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 获取知识库信息
 * @author xianyang
 * @param {String} ragCode 知识库标识
 * @returns {Promise<Object>} 知识库信息
 */
export async function getRagInfo(ragCode) {
    return ragInfoDac.getByCode(ragCode)
}

/**
 * @description 添加知识库
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {Object} ragInfo 知识库对象
 * @param {Number} needRagCode 是否需要传递知识库标识
 * @returns {Promise<Object>} 添加成功时返回新添加的知识库对象
 */
export async function addRagInfo(curUserInfo, ragInfo, needRagCode = 0) {
    if (!ragInfo) {
        throw new Error('未传递知识库数据')
    }
    if (!needRagCode && !ragInfo.ragCode) {
        ragInfo.ragCode = tools.getUUID()
    }
    if (!ragInfo.title || !ragInfo.ragCode) {
        throw new Error('需要知识库标题和知识库标识')
    }

    checkRagInfoField(ragInfo)

    let oldRagInfo = await ragInfoDac.getByCode(ragInfo.ragCode)
    if (oldRagInfo) {
        throw new Error('知识库标识已存在')
    }

    const embeddingConfig = config.embedding.find(_ => _.isDefault)

    let newRagInfo = {
        ...ragInfo,
        ragCode: ragInfo.ragCode,
        title: ragInfo.title,
        description: ragInfo.description,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
        usage: 0,
        tags: ragInfo.tags,
        ragType: ragInfo.ragType || 'self',
        embeddingModelProvider: embeddingConfig.provider,
        embeddingModelId: embeddingConfig.model,
        permission: ragInfo.permission || 'member',
        recommendedQuestions: ragInfo.recommendedQuestions || [],
        needApproval: ragInfo.needApproval ?? 1,
        members: [{userCode: curUserInfo.userCode, realName: curUserInfo.realName, memberType: 'owner'}]
    }
    let ret = await ragInfoDac.add(newRagInfo)

    return ret
}

/**
 * @description 修改知识库
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @param {Object} newRagInfo 新的知识库对象
 * @returns {Promise<Object>} 受影响的行数
 */
export async function updateRagInfo(curUserInfo, ragCode, newRagInfo) {
    if (!ragCode) {
        throw new Error('缺少知识库标识')
    }
    if (!newRagInfo) {
        throw new Error('没有要更新的数据')
    }

    checkRagInfoField(newRagInfo)

    let ragInfo = {
        ragCode,
        title: newRagInfo.title,
        description: newRagInfo.description,
        tags: newRagInfo.tags,
        metas: newRagInfo.metas,
        permission: newRagInfo.permission,
        permissionDepartmentCodes: newRagInfo.permissionDepartmentCodes,
        recommendedQuestions: newRagInfo.recommendedQuestions,
        needApproval: newRagInfo.needApproval,
    }

    let ret = await ragInfoDac.update(ragInfo)

    return ret
}

/**
 * @description 删除知识库
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteRagInfo(curUserInfo, ragCode) {
    if (!ragCode) {
        throw new Error('缺少知识库标识')
    }

    return ragInfoDac.update({ragCode, status: -1})
}

/**
 * @description 启用知识库
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function enableRagInfo(curUserInfo, ragCode) {
    if (!ragCode) {
        throw new Error('缺少知识库标识')
    }

    return ragInfoDac.update({ragCode, status: 0})
}

/**
 * @description 禁用知识库
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function disableRagInfo(curUserInfo, ragCode) {
    if (!ragCode) {
        throw new Error('缺少知识库标识')
    }

    return ragInfoDac.update({ragCode, status: 1})
}

/**
 * @description 校验知识库相关字段的合法性
 * @author menglb
 * @param {Object} ragInfo 知识库信息
 * @returns {Boolean} 校验是否通过
 */
function checkRagInfoField(ragInfo) {
    if (!ragInfo) {
        return true
    }
    checkCodeField(ragInfo.ragCode, '知识库标识')
    if (ragInfo.title) {
        if (!/^.{2,512}$/g.test(ragInfo.title)) {
            throw new Error('知识库标题至少2个字符，且总长度不能超过512个字符')
        }
    }
    return true
}

/**
 * @description 修改知识库成员
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @param {Object[]} newMembers 新的成员列表
 * @returns {Promise<Object>} 修改后的成员数量
 */
export async function saveMembers(curUserInfo, ragCode, newMembers) {
    let ragInfo = await ragInfoDac.getByCode(ragCode)
    if (!ragInfo) {
        throw new Error('知识库不存在')
    }

    let members = [{userCode: ragInfo.operator.userCode, realName: ragInfo.operator.realName, memberType: 'owner'}]
    newMembers.forEach(member => {
        if (member.userCode && member.realName && ['admin', 'user'].includes(member.memberType) && members.every(_ => _.userCode !== member.userCode)) {
            members.push({userCode: member.userCode, realName: member.realName, memberType: member.memberType})
        }
    })
    await ragInfoDac.update({ragCode, members})
    return members.length
}

/**
 * @description 添加成员
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @param {String} userCode 用户标识
 * @param {String} realName 用户姓名
 * @param {String} memberType 成员类型（admin/user）
 * @returns {Promise<Object>} 更新结果
 */
export async function addMember(curUserInfo, ragCode, userCode, realName, memberType = 'user') {
    if (!userCode || !realName) {
        throw new Error('缺少用户信息')
    }
    if (!['admin', 'user'].includes(memberType)) {
        throw new Error('无效的成员类型')
    }
    let ragInfo = await ragInfoDac.getByCode(ragCode)
    if (!ragInfo) {
        throw new Error('知识库不存在')
    }
    if (ragInfo.members?.some(m => m.userCode === userCode)) {
        throw new Error('该用户已是知识库成员')
    }
    let members = [...(ragInfo.members || []), {userCode, realName, memberType}]
    return ragInfoDac.update({ragCode, members})
}

/**
 * @description 移除成员
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @param {String} userCode 要移除的用户标识
 * @returns {Promise<Object>} 更新结果
 */
export async function removeMember(curUserInfo, ragCode, userCode) {
    let ragInfo = await ragInfoDac.getByCode(ragCode)
    if (!ragInfo) {
        throw new Error('知识库不存在')
    }
    if (ragInfo.operator?.userCode === userCode) {
        throw new Error('不能移除创建者')
    }
    let targetMember = (ragInfo.members || []).find(m => m.userCode === userCode)
    let members = (ragInfo.members || []).filter(m => m.userCode !== userCode)
    await ragInfoDac.update({ragCode, members})
    if (targetMember) {
        await addLog({
            ragCode,
            logType: 'member_remove',
            operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
            targetUser: {userCode: targetMember.userCode, realName: targetMember.realName},
        })
    }
    return ragInfoDac.getByCode(ragCode)
}

/**
 * @description 退出知识库
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @returns {Promise<Object>} 更新结果
 */
export async function quitMember(curUserInfo, ragCode) {
    let ragInfo = await ragInfoDac.getByCode(ragCode)
    if (!ragInfo) {
        throw new Error('知识库不存在')
    }
    if (ragInfo.operator?.userCode === curUserInfo.userCode) {
        throw new Error('创建者不能退出知识库')
    }
    let members = (ragInfo.members || []).filter(m => m.userCode !== curUserInfo.userCode)
    if (members.length === (ragInfo.members || []).length) {
        throw new Error('您不是该知识库的成员')
    }
    await ragInfoDac.update({ragCode, members})
    await addLog({
        ragCode,
        logType: 'member_quit',
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        targetUser: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
    })
    return ragInfoDac.getByCode(ragCode)
}

/**
 * @description 更新成员角色
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @param {String} userCode 用户标识
 * @param {String} memberType 新的成员类型
 * @returns {Promise<Object>} 更新结果
 */
export async function updateMemberType(curUserInfo, ragCode, userCode, memberType) {
    if (!['admin', 'user'].includes(memberType)) {
        throw new Error('无效的成员类型')
    }
    let ragInfo = await ragInfoDac.getByCode(ragCode)
    if (!ragInfo) {
        throw new Error('知识库不存在')
    }
    if (ragInfo.operator?.userCode === userCode) {
        throw new Error('不能修改创建者角色')
    }
    let oldMember = (ragInfo.members || []).find(m => m.userCode === userCode)
    let fromType = oldMember?.memberType || ''
    let members = (ragInfo.members || []).map(m => {
        if (m.userCode === userCode) {
            return {...m, memberType}
        }
        return m
    })
    await ragInfoDac.update({ragCode, members})
    if (oldMember) {
        await addLog({
            ragCode,
            logType: 'member_role_change',
            operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
            targetUser: {userCode: oldMember.userCode, realName: oldMember.realName},
            detail: {fromType, toType: memberType},
        })
    }
    return ragInfoDac.getByCode(ragCode)
}

/**
 * @description 申请加入知识库
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @returns {Promise<Object>} 申请结果，返回 {needApproval: 0|1} 表示是否需要审批
 */
export async function applyJoin(curUserInfo, ragCode) {
    let ragInfo = await ragInfoDac.getByCode(ragCode)
    if (!ragInfo) {
        throw new Error('知识库不存在')
    }
    if (ragInfo.members?.some(m => m.userCode === curUserInfo.userCode)) {
        throw new Error('您已是知识库成员')
    }

    if (ragInfo.needApproval === 0) {
        let members = [...(ragInfo.members || []), {userCode: curUserInfo.userCode, realName: curUserInfo.realName, memberType: 'user'}]
        await ragInfoDac.update({ragCode, members})
        await addLog({
            ragCode,
            logType: 'member_join',
            operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
            targetUser: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        })
        return {needApproval: 0}
    }

    let applications = ragInfo.applications || []
    if (applications.some(a => a.userCode === curUserInfo.userCode && a.status === 0)) {
        throw new Error('您已有待审批的申请')
    }
    applications = applications.filter(a => a.userCode !== curUserInfo.userCode || a.status === 0)
    applications.push({
        applicationCode: tools.getUUID(),
        userCode: curUserInfo.userCode,
        realName: curUserInfo.realName,
        status: 0,
        insertTime: new Date()
    })
    await ragInfoDac.update({ragCode, applications})
    await addLog({
        ragCode,
        logType: 'member_apply',
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        targetUser: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
    })
    return {needApproval: 1}
}

/**
 * @description 处理加入申请
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragCode 知识库标识
 * @param {String} applicationCode 申请标识
 * @param {Number} status 处理状态：1-同意，2-拒绝
 * @returns {Promise<Object>} 处理结果
 */
export async function handleApplication(curUserInfo, ragCode, applicationCode, status) {
    if (![1, 2].includes(status)) {
        throw new Error('无效的处理状态')
    }
    let ragInfo = await ragInfoDac.getByCode(ragCode)
    if (!ragInfo) {
        throw new Error('知识库不存在')
    }
    let applications = ragInfo.applications || []
    let application = applications.find(a => a.applicationCode === applicationCode)
    if (!application) {
        throw new Error('申请不存在')
    }
    if (application.status !== 0) {
        throw new Error('该申请已处理')
    }
    application.status = status
    application.handleTime = new Date()

    let updateData = {ragCode, applications}
    if (status === 1) {
        let members = ragInfo.members || []
        if (!members.some(m => m.userCode === application.userCode)) {
            members.push({userCode: application.userCode, realName: application.realName, memberType: 'user'})
            updateData.members = members
        }
    }
    await ragInfoDac.update(updateData)
    await addLog({
        ragCode,
        logType: status === 1 ? 'application_approve' : 'application_reject',
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        targetUser: {userCode: application.userCode, realName: application.realName},
    })
    return ragInfoDac.getByCode(ragCode)
}