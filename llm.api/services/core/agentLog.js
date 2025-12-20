/**
 * @fileOverview 智能体日志相关的业务操作
 * @author xianyang
 * @module
 */

import agentLogDac from '../../daos/core/dac/agentLogDac.js'
import retSchema from '../../daos/retSchema.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config

/**
 * @description 获取智能体执行日志
 * @author xianyang
 * @param {String} logCode 日志标识
 * @returns {Promise<Object>} 智能体执行日志信息
 */
export async function getAgentLog(logCode) {
    return agentLogDac.getByCode(logCode)
}

/*添加一条执行日志*/
export async function addAgentLog(agentTaskInfo, content, group = 'common', extInfo = {}, operator = null) {
    return agentLogDac.add({
        logCode: tools.getUUID(),
        agentCode: agentTaskInfo.agentCode,
        agentCodePath: agentTaskInfo.agentCodePath,
        group,
        content,
        operator: operator || agentTaskInfo.operator,
        extInfo
    })
}