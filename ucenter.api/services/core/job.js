/**
 * @fileOverview 职位相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import jobDac from '../../daos/core/dac/jobDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 获取职位列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 职位数组}
 */
export async function getJobs(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }

    return jobDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 添加职位
 * @author menglb
 * @param {Object} userInfo 当前用户
 * @param {Object} job 职位对象
 * @returns {Object} 添加成功时返回新添加的职位对象
 */
export async function addJob(userInfo, job) {
    if (!job) {
        throw new Error('未传递职位数据')
    }
    if (!job.jobName || !job.jobCode) {
        throw new Error('需要职位名称和职位标识')
    }

    let oldJob = await jobDac.getByCode(job.jobCode);
    if (oldJob) {
        throw new Error('职位标识已存在')
    }

    let jobInfo = {
        jobCode: job.jobCode,
        jobName: job.jobName,
        parentCode: job.parentCode,
        levelNum: job.levelNum,
        status: 0,
        orderNum: job.orderNum,
        orgCode: job.orgCode,
        adminCode: job.adminCode,
        path: job.path
    };

    return jobDac.add(jobInfo)
}

/**
 * @description 修改职位
 * @author menglb
 * @param {String} jobCode 职位标识
 * @param {Object} newJob 新的职位对象
 * @returns {Object} 受影响的行数
 */
export async function updateJob(jobCode, newJob) {
    if (!jobCode) {
        throw new Error('缺少职位标识')
    }
    if (!newJob) {
        throw new Error('没有要更新的数据')
    }

    let job = {
        jobCode,
        jobName: newJob.jobName,
        parentCode: newJob.parentCode,
        levelNum: newJob.levelNum,
        status: newJob.status,
        orderNum: newJob.orderNum,
        orgCode: newJob.orgCode,
        adminCode: newJob.adminCode,
        path: newJob.path
    };

    return jobDac.update(job)
}

/**
 * @description 删除职位
 * @author menglb
 * @param {String} jobCode 职位标识
 * @returns {Object} 受影响的行数
 */
export async function deleteJob(jobCode) {
    if (!jobCode) {
        throw new Error('缺少职位标识')
    }

    /** 能否删除的校验 */
    let job = await jobDac.getByCode(jobCode);
    if (!job) {
        throw new Error('职位不存在')
    }

    return jobDac.update({jobCode, status: -1})
}