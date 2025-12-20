/**
 * @fileOverview 智能体任务执行相关的rpc接口调用
 * @author xianyang
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const agentTaskConfig = llm.config.agentTask

// Protocol Buffers文件
const protoPath = 'grpc/clients/agentExecutor.proto'
const llmProto = loadProto(protoPath).llm

export async function execAgentTask(agentTaskInfo, grpcHost, chunkCallback) {
    let client = new llmProto.AgentExecutor(grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': agentTaskConfig.maxMessageLength,
            'grpc.max_receive_message_length': agentTaskConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        let call = client.execAgentTask({agentTaskInfo: JSON.stringify(agentTaskInfo)})
        let handleRet = null
        let handleStatus = agentTaskInfo.handleStatus
        call.on('data', function (response) {
            if (response.handleRet) {
                handleRet = JSON.parse(response.handleRet)
            }
            let logExt = {}
            if (response.logExt) {
                logExt = JSON.parse(response.logExt)
            }
            handleStatus = response.handleStatus
            chunkCallback({...response, handleRet, logExt})
        })

        call.on('end', function () {
            resolve({handleRet, handleStatus})
        })

        call.on('error', function (err) {
            reject(err)
        })
    })
}