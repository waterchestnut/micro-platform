/**
 * @fileOverview 资源管理的rpc接口调用
 * @author xianyang
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const resourceConfig = rag.config.resourceConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/resourceManage.proto'
const resourceProto = loadProto(protoPath).resource

export async function saveResource(curUserInfo, resCode, resInfo) {
    /*console.log(ragConfig, ragProto.RagSearch)*/
    let client = new resourceProto.ResourceManage(resourceConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': resourceConfig.maxMessageLength,
            'grpc.max_receive_message_length': resourceConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.saveResource({
            resCode,
            operator: curUserInfo,
            resInfos: JSON.stringify(resInfo)
        }, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.count)
        })
    })
}