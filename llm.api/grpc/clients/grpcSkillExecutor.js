/**
 * @fileOverview 智能体远程SKILL执行相关的rpc接口调用
 * @author xianyang
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const agentTaskConfig = llm.config.agentTask
const tools = llm.tools

// Protocol Buffers文件
const protoPath = 'grpc/clients/grpcSkillExecutor.proto'
const llmProto = loadProto(protoPath).llm

export async function execCommand(grpcHost, skillName, commandName, params) {
    let client = new llmProto.GrpcSkillExecutor(grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': agentTaskConfig.maxMessageLength,
            'grpc.max_receive_message_length': agentTaskConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.execSkillCommand({skillName, commandName, params: JSON.stringify(params)}, function (err, response) {
            if (err) {
                return resolve({
                    success: false,
                    command: commandName,
                    error: err.message || err,
                    message: `命令 ${skillName}.${commandName} 执行失败：${err.message || err}`,
                })
            }
            /*console.log('grpc ret:', response);*/
            return resolve({
                success: response.code === 0,
                command: commandName,
                error: response.msg || '',
                message: `命令 ${skillName}.${commandName} 执行${response.code === 0 ? '成功' : '失败'}`,
                data: tools.isString(response.data) ? JSON.parse(response.data) : response.data,
            })
        })
    })
}