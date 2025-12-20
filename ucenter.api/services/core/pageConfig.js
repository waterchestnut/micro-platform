/**
 * @fileOverview 权限配置相关的业务操作
 * @author xianyang
 * @module
 */

import pageConfigDac from '../../daos/core/dac/pageConfigDac.js'
import FindMyWay from 'find-my-way'
import {saveStatisticContent} from '../statistic/index.js'
import clientDac from '../../daos/core/dac/clientDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

export async function testRouter() {
    const router = new FindMyWay({})
    router.on('GET', '/test/:h45', async (req, res, params, store, searchParams) => {
        console.log(params.h45)
        return '/test/:h45'
    })
    const matchedRouter = router.find('GET', '/test/menglb')
    console.log(matchedRouter, await matchedRouter.handler({}, {}, matchedRouter.params))
    return 'done'
}

/**
 * @description 保存页面配置信息
 * @author menglb
 * @param {Object} info 页面配置信息对象
 * @returns {Object} 保存是否成功
 */
export async function savePageConfig(info) {
    info = info || {}
    if (!info.path || !info.method || !info.clientCode) {
        throw new Error('参数不全')
    }
    if (!info.pageConfigCode) {
        info.pageConfigCode = tools.getUUID()
    }

    return pageConfigDac.bulkUpdateByPath([info])
}

/**
 * @description 读取所有的页面配置信息
 * @author menglb
 * @returns {Object} 页面配置信息
 */
export async function getAllPageConfig() {
    return pageConfigDac.findAllPageConfig()
}

/**
 * @description 获取页面配置列表
 * @author menglb
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @param {Number} [options.withFormat] 是否格式化所属应用等字段的名称
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 页面配置数组}
 */
export async function getPageConfigList(filter, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }

    let ret = await pageConfigDac.getByPage(pageIndex, pageSize, optionsIn)
    if (options.withFormat && ret?.rows?.length) {
        let clientCodeList = [...new Set(ret.rows.map(item => item.clientCode))]
        let clientList = await clientDac.getTop(clientCodeList.length, {clientCode: clientCodeList})
        ret.rows.forEach(item => {
            item.clientName = clientList.find(_ => _.clientCode === item.clientCode)?.clientName
        })
    }

    return ret
}

/**
 * @description 删除页面配置信息
 * @author menglb
 * @param {String} pageConfigCode 唯一标识
 * @returns {Object} 删除是否成功
 */
export async function deletePageConfig(pageConfigCode) {
    return pageConfigDac.deleteByCode(pageConfigCode)
}

/**
 * @description 整体更新所有的页面配置（删除旧数据）
 * @author menglb
 * @param {Object} curUserInfo 当前登录用户
 * @param {Array} pageConfigs 全部的页面配置列表
 * @returns {Object} 更新是否成功
 */
export async function updateAll(curUserInfo, pageConfigs) {
    const oldList = await pageConfigDac.findAllPageConfig()
    await saveStatisticContent('update-all-page-config', '重置所有的权限配置', {detail: oldList}, curUserInfo)
    await pageConfigDac.clearAllPageConfig()
    return pageConfigDac.bulkUpdateByPath(pageConfigs)
}

/**
 * @description 整体更新某个应用的页面配置（删除旧数据）
 * @author menglb
 * @param {Object} curUserInfo 当前登录用户
 * @param {String} clientCode 应用标识
 * @param {Array} pageConfigs 应用的页面配置列表
 * @returns {Object} 更新是否成功
 */
export async function updateByClient(curUserInfo, clientCode, pageConfigs) {
    const oldList = await pageConfigDac.getTop(2000, {clientCode: clientCode})
    pageConfigs?.forEach((item) => {
        item.clientCode = clientCode
    })
    await saveStatisticContent('update-client-page-config', '重置应用的权限配置', {detail: oldList}, curUserInfo)
    await pageConfigDac.destroyByFilter({clientCode: clientCode})
    return pageConfigDac.bulkUpdateByPath(pageConfigs)
}