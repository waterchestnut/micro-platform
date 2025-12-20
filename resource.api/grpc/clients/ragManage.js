/**
 * @fileOverview 知识库管理的rpc接口调用
 * @author xianyang
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const ragConfig = resource.config.ragConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/ragManage.proto'
const ragProto = loadProto(protoPath).rag

export async function checkMaterial(curUserInfo, ragCode, ragType, ragInfo, materialInfo) {
    /*console.log(ragConfig, ragProto.RagSearch)*/
    let client = new ragProto.RagManage(ragConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': ragConfig.maxMessageLength,
            'grpc.max_receive_message_length': ragConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.checkMaterial({
            ragCode,
            ragType,
            operator: curUserInfo,
            ragInfos: JSON.stringify(ragInfo),
            materials: JSON.stringify(materialInfo),
        }, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(JSON.parse(response.materials))
        })
    })
}