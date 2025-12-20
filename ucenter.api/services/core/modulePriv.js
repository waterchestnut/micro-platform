/**
 * @fileOverview 功能权限相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import modulePrivDac from '../../daos/core/dac/modulePrivDac.js'
import AuthTypeEnum from '../../daos/core/enum/AuthTypeEnum.js'
import clientDac from "../../daos/core/dac/clientDac.js";
import moduleDac from "../../daos/core/dac/moduleDac.js";

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 获取功能权限列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @param {Number} [options.withFormat] 是否格式化所属应用、所属模块等字段的名称
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 功能权限数组}
 */
export async function getModulePrivs(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }

    let ret = await modulePrivDac.getByPage(pageIndex, pageSize, optionsIn)
    if (options.withFormat && ret?.rows?.length) {
        let clientCodeList = [...new Set(ret.rows.map(item => item.clientCode))]
        let moduleCodeList = [...new Set(ret.rows.map(item => item.moduleCode))]
        let clientList = await clientDac.getTop(clientCodeList.length, {clientCode: clientCodeList})
        let moduleList = await moduleDac.getTop(moduleCodeList.length, {moduleCode: moduleCodeList})
        ret.rows.forEach(item => {
            item.clientName = clientList.find(_ => _.clientCode === item.clientCode)?.clientName
            item.moduleName = moduleList.find(_ => _.moduleCode === item.moduleCode)?.moduleName
        })
    }

    return ret
}

/**
 * @description 添加功能权限
 * @author menglb
 * @param {Object} userInfo 当前用户
 * @param {Object} modulePriv 功能权限对象
 * @returns {Object} 添加成功时返回新添加的功能权限对象
 */
export async function addModulePriv(userInfo, modulePriv) {
    if (!modulePriv) {
        throw new Error('未传递功能权限数据')
    }
    if (!modulePriv.modulePrivName || !modulePriv.modulePrivCode) {
        throw new Error('需要功能权限名称和功能权限标识')
    }

    let oldModulePriv = await modulePrivDac.getByCode(modulePriv.modulePrivCode);
    if (oldModulePriv) {
        throw new Error('功能权限标识已存在')
    }

    let modulePrivInfo = {
        modulePrivCode: modulePriv.modulePrivCode,
        modulePrivName: modulePriv.modulePrivName,
        privVerb: modulePriv.privVerb,
        moduleCode: modulePriv.moduleCode,
        status: 0,
        authType: AuthTypeEnum.managed.value,
        clientCode: modulePriv.clientCode
    };

    return modulePrivDac.add(modulePrivInfo)
}

/**
 * @description 修改功能权限
 * @author menglb
 * @param {String} modulePrivCode 功能权限标识
 * @param {Object} newModulePriv 新的功能权限对象
 * @returns {Object} 受影响的行数
 */
export async function updateModulePriv(modulePrivCode, newModulePriv) {
    if (!modulePrivCode) {
        throw new Error('缺少功能权限标识')
    }
    if (!newModulePriv) {
        throw new Error('没有要更新的数据')
    }

    let modulePriv = {
        modulePrivCode,
        modulePrivName: newModulePriv.modulePrivName,
        privVerb: newModulePriv.privVerb,
        moduleCode: newModulePriv.moduleCode
    };

    return modulePrivDac.update(modulePriv)
}

/**
 * @description 删除功能权限
 * @author menglb
 * @param {String} modulePrivCode 功能权限标识
 * @returns {Object} 受影响的行数
 */
export async function deleteModulePriv(modulePrivCode) {
    if (!modulePrivCode) {
        throw new Error('缺少功能权限标识')
    }

    /** 能否删除的校验 */
    let modulePriv = await modulePrivDac.getByCode(modulePrivCode);
    if (!modulePriv) {
        throw new Error('功能权限不存在')
    }
    if (modulePriv.authType !== AuthTypeEnum.managed.value) {
        throw new Error('内置功能权限，无法删除')
    }

    return modulePrivDac.update({modulePrivCode, status: -1})
}