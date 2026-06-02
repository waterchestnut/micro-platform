/**
 * @fileOverview 文本翻译相关的rpc接口调用
 * @author xianyang
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const llmApiConfig = resource.config.llmApiConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/trans.proto'
const llmProto = loadProto(protoPath).llm

export async function autoTrans(sourceText) {
    let client = new llmProto.Trans(llmApiConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': llmApiConfig.maxMessageLength,
            'grpc.max_receive_message_length': llmApiConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.autoTrans({sourceText}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.transText)
        })
    })
}

export async function nonChineseTrans(sourceText, onlyFull = false) {
    let client = new llmProto.Trans(llmApiConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': llmApiConfig.maxMessageLength,
            'grpc.max_receive_message_length': llmApiConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.nonChineseTrans({sourceText, onlyFull}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve({
                fullTrans: response.fullTrans,
                sentenceTrans: response.sentenceTrans,
            })
        })
    })
}
