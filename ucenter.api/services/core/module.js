/**
 * @fileOverview 授权分类相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import moduleDac from '../../daos/core/dac/moduleDac.js'
import AuthTypeEnum from '../../daos/core/enum/AuthTypeEnum.js'
import clientDac from "../../daos/core/dac/clientDac.js";

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 获取模块列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @param {Number} [options.withFormat] 是否格式化所属应用等字段的名称
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 模块数组}
 */
export async function getModules(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }

    let ret = await moduleDac.getByPage(pageIndex, pageSize, optionsIn)
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
 * @description 添加模块
 * @author menglb
 * @param {Object} userInfo 当前用户
 * @param {Object} module 模块对象
 * @returns {Object} 添加成功时返回新添加的模块对象
 */
export async function addModule(userInfo, module) {
    if (!module) {
        throw new Error('未传递模块数据')
    }
    if (!module.moduleName || !module.moduleCode) {
        throw new Error('需要模块名称和模块标识')
    }

    let oldModule = await moduleDac.getByCode(module.moduleCode)
    if (oldModule) {
        throw new Error('模块标识已存在')
    }

    let moduleInfo = {
        moduleCode: module.moduleCode,
        moduleName: module.moduleName,
        status: 0,
        authType: AuthTypeEnum.managed.value,
        clientCode: module.clientCode
    };

    return moduleDac.add(moduleInfo)
}

/**
 * @description 修改模块
 * @author menglb
 * @param {String} moduleCode 模块标识
 * @param {Object} newModule 新的模块对象
 * @returns {Object} 受影响的行数
 */
export async function updateModule(moduleCode, newModule) {
    if (!moduleCode) {
        throw new Error('缺少模块标识')
    }
    if (!newModule) {
        throw new Error('没有要更新的数据')
    }

    let module = {
        moduleCode,
        moduleName: newModule.moduleName
    };

    return moduleDac.update(module)
}

/**
 * @description 删除模块
 * @author menglb
 * @param {String} moduleCode 模块标识
 * @returns {Object} 受影响的行数
 */
export async function deleteModule(moduleCode) {
    if (!moduleCode) {
        throw new Error('缺少模块标识')
    }

    /*校验模块*/
    let module = await moduleDac.getByCode(moduleCode)
    if (!module || !module.moduleCode) {
        throw new Error('模块不存在')
    }
    if (module.authType !== AuthTypeEnum.managed.value) {
        throw new Error('内置模块，无法删除')
    }

    return moduleDac.update({status: -1}, {$or: [{moduleCode}]})
}