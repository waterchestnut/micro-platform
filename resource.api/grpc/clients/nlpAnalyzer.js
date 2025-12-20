/**
 * @fileOverview 文本NLP分析相关的rpc接口调用
 * @author xianyang 2025/6/19
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const transformConfig = resource.config.transformConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/nlp_analyzer.proto'
const ragProto = loadProto(protoPath).rag

export async function text2Sents(text, language) {
    let client = new ragProto.NlpAnalyzer(transformConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': transformConfig.maxMessageLength,
            'grpc.max_receive_message_length': transformConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.text2Sents({text, language}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response)
        })
    })
}