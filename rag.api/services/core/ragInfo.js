/**
 * @fileOverview 知识库管理相关的业务操作
 * @author xianyang
 * @module
 */

import ragInfoDac from '../../daos/core/dac/ragInfoDac.js'
import retSchema from '../../daos/retSchema.js'
import {checkCodeField} from '../../tools/check.js'

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
        ragType: 'self',
        embeddingModelProvider: embeddingConfig.provider,
        embeddingModelId: embeddingConfig.model,
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
        if (member.userCode && member.realName && ['write', 'read'].includes(member.memberType) && members.every(_ => _.userCode !== member.userCode)) {
            members.push({userCode: member.userCode, realName: member.realName, memberType: member.memberType})
        }
    })
    await ragInfoDac.update({ragCode, members})
    return members.length
}