/**
 * @fileOverview 文本提取相关的rpc接口调用
 * @author xianyang 2025/6/10
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const transformConfig = rag.config.transformConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/extractor.proto'
const ragProto = loadProto(protoPath).rag

export async function pdf2Text(content, language) {
    let client = new ragProto.Extractor(transformConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': transformConfig.maxMessageLength,
            'grpc.max_receive_message_length': transformConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.pdf2Text({content, language}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.text)
        })
    })
}

export async function word2Text(content, language) {
    let client = new ragProto.Extractor(transformConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': transformConfig.maxMessageLength,
            'grpc.max_receive_message_length': transformConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.word2Text({content, language}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.text)
        })
    })
}

export async function excel2Text(content, language) {
    let client = new ragProto.Extractor(transformConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': transformConfig.maxMessageLength,
            'grpc.max_receive_message_length': transformConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.excel2Text({content, language}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.text)
        })
    })
}

export async function html2Text(content, language) {
    let client = new ragProto.Extractor(transformConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': transformConfig.maxMessageLength,
            'grpc.max_receive_message_length': transformConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.html2Text({content, language}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.text)
        })
    })
}