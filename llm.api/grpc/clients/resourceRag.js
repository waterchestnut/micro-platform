/**
 * @fileOverview 资源增强检索的rpc接口调用
 * @author xianyang
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const resourceConfig = llm.config.resourceConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/resourceRag.proto'
const resourceProto = loadProto(protoPath).resource

export async function llmRagSearch(query, resCode, options) {
    /*console.log(ragConfig, ragProto.RagSearch)*/
    let client = new resourceProto.ResourceRag(resourceConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': resourceConfig.maxMessageLength,
            'grpc.max_receive_message_length': resourceConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.llmRagSearch({
            query,
            resCode,
            options: JSON.stringify(options)
        }, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.segments)
        })
    })
}