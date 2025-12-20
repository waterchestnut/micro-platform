/**
 * @fileOverview 应用下的模块相关的业务操作
 * @author xianyang
 * @module
 */

import {addModule, deleteModule, getModuleList} from '../../grpc/clients/module.js'
import {checkCodeField} from '../../tools/check.js'

const tools = app.tools
const logger = app.logger
const config = app.config

/**
 * @description 获取模块列表
 * @author xianyang
 * @param {String} clientCode 应用标识
 * @returns {Promise<[Object]>} 模块数组
 */
export async function getClientModules(clientCode) {
    return getModuleList(clientCode)
}

/**
 * @description 添加模块
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {Object} module 模块对象
 * @returns {Object} 添加成功时返回新添加的模块对象
 */
export async function addClientModule(curUserInfo, clientCode, module) {
    if (!module) {
        throw new Error('未传递模块数据')
    }
    if (!module.moduleName || !module.moduleCode) {
        throw new Error('需要模块名称和模块标识')
    }

    checkCodeField(module.moduleCode, '模块标识')
    const moduleCode = module.moduleCode.startsWith(`${clientCode}-`) ? module.moduleCode : `${clientCode}-${module.moduleCode}`

    let newModuleInfo = {
        moduleCode,
        moduleName: module.moduleName,
        clientCode: module.clientCode,
    }

    return addModule(curUserInfo, newModuleInfo)
}

/**
 * @description 删除模块
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} clientCode 应用标识
 * @param {String} moduleCode 模块标识
 * @returns {Object} 受影响的行数
 */
export async function deleteClientModule(curUserInfo, clientCode, moduleCode) {
    if (!clientCode) {
        throw new Error('缺少应用标识')
    }
    if (moduleCode === `${clientCode}-main`) {
        throw new Error('基础模块，不能删除')
    }

    let moduleList = await getModuleList(clientCode)
    if (!moduleList?.find(_ => _.moduleCode === moduleCode)) {
        throw new Error('模块不存在')
    }

    return deleteModule(curUserInfo, moduleCode)
}