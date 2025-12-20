/**
 * @fileOverview 文件格式转换相关的rpc接口调用
 * @author xianyang
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const transformConfig = doc.config.transformConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/converter.proto'
const ragProto = loadProto(protoPath).rag

export async function convertImage(content, targetFormat) {
    let client = new ragProto.Converter(transformConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': transformConfig.maxMessageLength,
            'grpc.max_receive_message_length': transformConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.convertImage({content, targetFormat}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.content)
        })
    })
}