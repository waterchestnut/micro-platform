/**
 * @fileOverview 部门相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import departmentDac from '../../daos/core/dac/departmentDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 获取部门列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 部门数组}
 */
export async function getDepartments(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }

    return departmentDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 添加部门
 * @author menglb
 * @param {Object} userInfo 当前用户
 * @param {Object} department 部门对象
 * @returns {Object} 添加成功时返回新添加的部门对象
 */
export async function addDepartment(userInfo, department) {
    if (!department) {
        throw new Error('未传递部门数据')
    }
    if (!department.departmentName || !department.departmentCode) {
        throw new Error('需要部门名称和部门标识')
    }

    let oldDepartment = await departmentDac.getByCode(department.departmentCode);
    if (oldDepartment) {
        throw new Error('部门标识已存在')
    }

    let departmentInfo = {
        departmentCode: department.departmentCode,
        departmentName: department.departmentName,
        parentCode: department.parentCode,
        levelNum: department.levelNum,
        status: 0,
        orderNum: department.orderNum,
        orgCode: department.orgCode,
        adminCode: department.adminCode,
        path: department.path,
        isTemp: department.isTemp
    };

    return departmentDac.add(departmentInfo)
}

/**
 * @description 修改部门
 * @author menglb
 * @param {String} departmentCode 部门标识
 * @param {Object} newDepartment 新的部门对象
 * @returns {Object} 受影响的行数
 */
export async function updateDepartment(departmentCode, newDepartment) {
    if (!departmentCode) {
        throw new Error('缺少部门标识')
    }
    if (!newDepartment) {
        throw new Error('没有要更新的数据')
    }

    let department = {
        departmentCode,
        departmentName: newDepartment.departmentName,
        parentCode: newDepartment.parentCode,
        levelNum: newDepartment.levelNum,
        status: newDepartment.status,
        orderNum: newDepartment.orderNum,
        orgCode: newDepartment.orgCode,
        adminCode: newDepartment.adminCode,
        path: newDepartment.path,
        isTemp: newDepartment.isTemp
    };

    return departmentDac.update(department)
}

/**
 * @description 删除部门
 * @author menglb
 * @param {String} departmentCode 部门标识
 * @returns {Object} 受影响的行数
 */
export async function deleteDepartment(departmentCode) {
    if (!departmentCode) {
        throw new Error('缺少部门标识')
    }

    /** 能否删除的校验 */
    let department = await departmentDac.getByCode(departmentCode);
    if (!department) {
        throw new Error('部门不存在')
    }

    return departmentDac.update({departmentCode, status: -1})
}