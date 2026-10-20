/**
 * @fileOverview 智能体任务构建相关的rpc服务
 * @author xianyang
 * @pageConfig
 */

import {loadProto} from '../utils.js'
import {addAgentTask, getAgentTaskAllDetail, getAgentTaskListByFilter, updateAgentTaskWithLock} from '../../services/core/agentTask.js'
import {addAgentLog as addAgentLogService} from '../../services/core/agentLog.js'
import {manualTriggerAgentTask} from '../../services/agent/index.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/agentController.proto'
const llmProto = loadProto(protoPath).llm

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(llmProto.AgentController.service, {
        addAgentTask: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await addAgentTask(JSON.parse(call.request.agentTaskInfo))
                callback(null, {count: ret})
            } catch (e) {
                callback(e)
            }
        },
        triggerAgentTask: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await manualTriggerAgentTask(call.request.agentCode)
                callback(null, ret)
            } catch (e) {
                callback(e)
            }
        },
        getAgentTaskAllDetail: async (call, callback) => {
            try {
                let data = await getAgentTaskAllDetail(call.request.agentCode);
                callback(null, {data: JSON.stringify(data)});
            } catch (e) {
                callback(e)
            }
        },
        getAgentTaskListByFilter: async (call, callback) => {
            try {
                let list = await getAgentTaskListByFilter(call.request);
                callback(null, {data: JSON.stringify(list)});
            } catch (e) {
                callback(e)
            }
        },
        addAgentLog: async (call, callback) => {
            try {
                let req = call.request
                let operator = null
                let extInfo = {}
                if (req.operator) {
                    operator = JSON.parse(req.operator)
                }
                if (req.extInfo) {
                    extInfo = JSON.parse(req.extInfo)
                }
                let ret = await addAgentLogService({
                    agentCode: req.agentCode,
                    agentCodePath: req.agentCodePath,
                    operator,
                }, req.content, req.group || 'common', extInfo, operator)
                callback(null, {count: ret ? 1 : 0})
            } catch (e) {
                callback(e)
            }
        },
        updateAgentTask: async (call, callback) => {
            try {
                let ret = await updateAgentTaskWithLock(call.request.agentCode, JSON.parse(call.request.toUpdateInfo))
                callback(null, {count: ret ? 1 : 0})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}