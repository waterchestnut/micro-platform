/**
 * @fileOverview 文档文本提取相关的rpc接口调用（对接 rag pyserver/transform 的 Extractor 服务）
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const ragPyServerConfig = doc.config.ragPyServerConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/extractor.proto'
const ragProto = loadProto(protoPath).rag

function newClient() {
    return new ragProto.Extractor(ragPyServerConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': ragPyServerConfig.maxMessageLength,
            'grpc.max_receive_message_length': ragPyServerConfig.maxMessageLength,
        })
}

function callMethod(method, content, language) {
    const client = newClient()
    return new Promise((resolve, reject) => {
        client[method]({content, language}, function (err, response) {
            if (err) {
                return reject(err)
            }
            return resolve(response.text)
        })
    })
}

export async function pdf2Text(content, language = '') {
    return callMethod('pdf2Text', content, language)
}

export async function word2Text(content, language = '') {
    return callMethod('word2Text', content, language)
}

export async function excel2Text(content, language = '') {
    return callMethod('excel2Text', content, language)
}

export async function html2Text(content, language = '') {
    return callMethod('html2Text', content, language)
}

export async function image2Text(content, language = '') {
    return callMethod('image2Text', content, language)
}
