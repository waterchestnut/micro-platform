/**
 * @fileOverview 远程技能相关的rpc服务
 * @author xianyang
 * @pageConfig
 */

import {loadProto} from '../utils.js'
import {execCommand} from '../../services/skill/index.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/grpcSkillExecutor.proto'
const llmProto = loadProto(protoPath).llm

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(llmProto.GrpcSkillExecutor.service, {
        execSkillCommand: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await execCommand(call.request.skillName, call.request.commandName, JSON.parse(call.request.params), JSON.parse(call.request.curUserInfo))
                callback(null, ret)
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}