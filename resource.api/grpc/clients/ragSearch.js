/**
 * @fileOverview 知识库检索的rpc接口调用
 * @author xianyang 2025/7/1
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const ragConfig = resource.config.ragConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/ragSearch.proto'
const ragProto = loadProto(protoPath).rag

export async function ragSearch(subject, options = {}) {
    /*console.log(ragConfig, ragProto.RagSearch)*/
    let client = new ragProto.RagSearch(ragConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': ragConfig.maxMessageLength,
            'grpc.max_receive_message_length': ragConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.ragSearch({subject, options: JSON.stringify(options)}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.contentItems)
        })
    })
}

export async function simpleResRag(subject, resCode, ragMaterialCode, fileHashCode, maxTokens, options = {}) {
    /*console.log(ragConfig, ragProto.RagSearch)*/
    let client = new ragProto.RagSearch(ragConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': ragConfig.maxMessageLength,
            'grpc.max_receive_message_length': ragConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.simpleResRag({
            subject,
            resCode,
            ragMaterialCode,
            fileHashCode,
            maxTokens,
            options: JSON.stringify(options)
        }, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.segList)
        })
    })
}