/**
 * @fileOverview 智能体任务构建相关的rpc服务
 * @author xianyang
 * @pageConfig
 */

import {loadProto} from '../utils.js'
import {addAgentTask, getAgentTaskAllDetail} from '../../services/core/agentTask.js'
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
        }
    })

    return server
}