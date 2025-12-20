/**
 * @fileOverview 机构相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import orgInfoDac from '../../daos/core/dac/orgInfoDac.js'
import {pinyin} from 'pinyin-pro'
import AuthTypeEnum from '../../daos/core/enum/AuthTypeEnum.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 格式化机构数据
 * @author menglb
 * @param {Array} orgList 机构列表
 * @returns {Object} 格式化后的机构列表
 */
async function formatOrgList(orgList) {
    if (!orgList || !orgList.length) {
        return orgList
    }
    /*@todo 处理格式化数据*/

    return orgList
}

/**
 * @description 获取机构列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 机构数组}
 */
export async function getOrgList(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }

    let ret = await orgInfoDac.getByPage(pageIndex, pageSize, optionsIn)
    await formatOrgList(ret.rows)
    return ret
}

/**
 * @description 读取机构详细信息
 * @author menglb
 * @param {String} orgCode 机构标识
 * @returns {Object} 机构信息对象
 */
export async function getOrgDetail(orgCode) {
    if (!orgCode) {
        return null
    }
    let org = await orgInfoDac.getByCode(orgCode)
    if (!org) {
        return org
    }
    return (await formatOrgList([org]))[0]
}

/**
 * @description 添加机构
 * @author menglb
 * @param {Object} userInfo 当前用户
 * @param {Object} orgInfo 机构对象
 * @returns {Object} 添加成功时返回新添加的机构对象
 */
export async function addOrgInfo(userInfo, orgInfo) {
    if (!orgInfo) {
        throw new Error('未传递机构数据')
    }
    if (!orgInfo.orgName) {
        throw new Error('机构名称不能为空')
    }

    if (orgInfo.orgCode) {
        let orgByOrgCode = await orgInfoDac.getByCode(orgInfo.orgCode)
        if (orgByOrgCode) {
            throw new Error('机构标识已经存在！')
        }
    }
    let orgByOrgName = await orgInfoDac.getByOrgName(orgInfo.orgName)
    if (orgByOrgName) {
        throw new Error('机构名称已经存在！')
    }
    if (!orgInfo.orgCode) {
        orgInfo.orgCode = tools.getUUID()
    }

    let letters = orgInfo.letters || pinyin(orgInfo.orgName, {
        pattern: 'first',
        toneType: 'none',
        type: 'array'
    }).join('').toLowerCase()
    let firstLetter = orgInfo.firstLetter || letters.substring(0, 1)
    let namePinyin = orgInfo.pinyin || pinyin(orgInfo.orgName, {
        pattern: 'pinyin',
        toneType: 'none', type: 'array'
    }).join('').toLowerCase()

    let org = {
        orgCode: orgInfo.orgCode,
        orgName: orgInfo.orgName,
        orgNameEn: orgInfo.orgNameEn,
        coverUrl: orgInfo.coverUrl,
        des: orgInfo.des,
        desEn: orgInfo.desEn,
        firstLetter,
        letters,
        pinyin: namePinyin,
        address: orgInfo.address,
        contactList: orgInfo.contactList,
        orgTypes: orgInfo.orgTypes,
        status: 0,
        authType: AuthTypeEnum.managed.value
    }

    return orgInfoDac.add(org)
}

/**
 * @description 修改机构
 * @author menglb
 * @param {String} orgCode 机构标识
 * @param {Object} newOrg 新的机构对象
 * @returns {Object} 受影响的行数
 */
export async function updateOrgInfo(orgCode, newOrg) {
    if (!orgCode) {
        throw new Error('缺少机构标识')
    }
    if (!newOrg) {
        throw new Error('没有要更新的数据')
    }
    /** 校验机构是否存在 */
    let oldOrg = await orgInfoDac.getByCode(orgCode)
    if (!oldOrg) {
        throw new Error('机构不存在')
    }
    let orgInfo = {
        orgCode,
        orgName: newOrg.orgName,
        orgNameEn: newOrg.orgNameEn,
        coverUrl: newOrg.coverUrl,
        des: newOrg.des,
        desEn: newOrg.desEn,
        address: newOrg.address,
        contactList: newOrg.contactList,
        orgTypes: newOrg.orgTypes,
        firstLetter: newOrg.firstLetter,
        letters: newOrg.letters,
        pinyin: newOrg.pinyin
    }
    if (newOrg.orgName) {
        let orgByOrgName = await orgInfoDac.getByOrgName(newOrg.orgName)
        if (orgByOrgName && orgByOrgName.orgCode !== orgCode) {
            throw new Error('机构名称已经存在！')
        }
        let letters = newOrg.letters || pinyin(newOrg.orgName, {
            pattern: 'first',
            toneType: 'none',
            type: 'array'
        }).join('').toLowerCase()
        let firstLetter = newOrg.firstLetter || letters.substring(0, 1)
        let namePinyin = newOrg.pinyin || pinyin(newOrg.orgName, {
            pattern: 'pinyin',
            toneType: 'none', type: 'array'
        }).join('').toLowerCase()
        orgInfo.firstLetter = firstLetter
        orgInfo.letters = letters
        orgInfo.pinyin = namePinyin
    }

    return orgInfoDac.update(orgInfo)
}

/**
 * @description 删除机构
 * @author menglb
 * @param {String} orgCode 机构标识
 * @returns {Object} 受影响的行数
 */
export async function deleteOrgInfo(orgCode) {
    if (!orgCode) {
        throw new Error('缺少机构标识')
    }

    /** 能否删除的校验 */
    let orgInfo = await orgInfoDac.getByCode(orgCode)
    if (!orgInfo) {
        throw new Error('机构不存在')
    }

    return orgInfoDac.update({orgCode, status: -1})
}

/**
 * @description 检查机构状态
 * @author menglb
 * @param {String} orgCode 机构标识
 * @returns {*} 机构信息
 */
export async function checkOrgStatus(orgCode) {
    let orgInfo = await orgInfoDac.getByCode(orgCode)

    if (!orgInfo || !orgInfo.orgCode) {
        //机构不存在
        throw retSchema.FAIL_ORG_NOT_EXIST
    }
    if (orgInfo.status !== 0) {
        //机构非正常使用
        throw retSchema.FAIL_ORG_DISABLED
    }
    return orgInfo
}