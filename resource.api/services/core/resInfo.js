/**
 * @fileOverview 资源管理相关的业务操作
 * @author xianyang
 * @module
 */

import resInfoDac from '../../daos/core/dac/resInfoDac.js'
import retSchema from '../../daos/retSchema.js'
import {checkCodeField} from '../../tools/check.js'

const tools = resource.tools
const logger = resource.logger
const config = resource.config

/**
 * @description 获取资源列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 资源数组}
 */
export async function getResInfos(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {updateTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return resInfoDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 获取资源信息
 * @author xianyang
 * @param {String} resCode 资源标识
 * @returns {Promise<Object>} 资源信息
 */
export async function getResInfo(resCode) {
    return resInfoDac.getByCode(resCode)
}

/**
 * @description 添加资源
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {Object} resInfo 资源对象
 * @param {Number} needResCode 是否需要传递资源标识
 * @returns {Promise<Object>} 添加成功时返回新添加的资源对象
 */
export async function addResInfo(curUserInfo, resInfo, needResCode = 0) {
    if (!resInfo) {
        throw new Error('未传递资源数据')
    }
    if (!needResCode && !resInfo.resCode) {
        resInfo.resCode = tools.getUUID()
    }
    if (!resInfo.title || !resInfo.resCode) {
        throw new Error('需要资源标题和资源标识')
    }

    checkResInfoField(resInfo)

    let oldResInfo = await resInfoDac.getByCode(resInfo.resCode)
    if (oldResInfo) {
        throw new Error('资源标识已存在')
    }

    let newResInfo = {
        ...resInfo,
        resCode: resInfo.resCode,
        title: resInfo.title,
        abstract: resInfo.abstract,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
    }
    let ret = await resInfoDac.add(newResInfo)

    return ret
}

/**
 * @description 修改资源
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} resCode 资源标识
 * @param {Object} newResInfo 新的资源对象
 * @returns {Promise<Object>} 受影响的行数
 */
export async function updateResInfo(curUserInfo, resCode, newResInfo) {
    if (!resCode) {
        throw new Error('缺少资源标识')
    }
    if (!newResInfo) {
        throw new Error('没有要更新的数据')
    }

    checkResInfoField(newResInfo)

    let resInfo = {
        resCode,
        title: newResInfo.title,
        abstract: newResInfo.abstract,
        tags: newResInfo.tags,
    }

    let ret = await resInfoDac.update(resInfo)

    return ret
}

/**
 * @description 保存资源（不存在时插入）
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} resCode 资源标识
 * @param {Object} newResInfo 新的资源对象
 * @returns {Promise<Number>} 受影响的行数
 */
export async function saveResInfo(curUserInfo, resCode, newResInfo) {
    if (!resCode) {
        throw new Error('缺少资源标识')
    }
    if (!curUserInfo?.userCode) {
        throw new Error('缺少操作者标识')
    }
    if (!newResInfo) {
        throw new Error('没有要保存的数据')
    }

    checkResInfoField(newResInfo)

    let resInfo = {
        ...newResInfo,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
    }

    let ret = await resInfoDac.upsert(resInfo)

    return 1
}

/**
 * @description 删除资源
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} resCode 资源标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteResInfo(curUserInfo, resCode) {
    if (!resCode) {
        throw new Error('缺少资源标识')
    }

    return resInfoDac.update({resCode, status: -1})
}

/**
 * @description 校验资源相关字段的合法性
 * @author menglb
 * @param {Object} resInfo 资源信息
 * @returns {Boolean} 校验是否通过
 */
function checkResInfoField(resInfo) {
    if (!resInfo) {
        return true
    }
    checkCodeField(resInfo.resCode, '资源标识')
    if (resInfo.title) {
        if (!/^.{2,512}$/g.test(resInfo.title)) {
            throw new Error('资源标题至少2个字符，且总长度不能超过512个字符')
        }
    }
    return true
}