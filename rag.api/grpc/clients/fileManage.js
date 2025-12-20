/**
 * @fileOverview 文件管理的rpc接口调用
 * @author xianyang
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const docConfig = rag.config.docConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/fileManage.proto'
const docProto = loadProto(protoPath).doc

export async function saveFile(curUserInfo, fileCode, fileInfo, extInfo, buffer, folder = '') {
    /*console.log(ragConfig, ragProto.RagSearch)*/
    let client = new docProto.FileManage(docConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': docConfig.maxMessageLength,
            'grpc.max_receive_message_length': docConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.saveFile({
            fileCode,
            operator: curUserInfo,
            fileInfos: JSON.stringify(fileInfo),
            extInfos: JSON.stringify(extInfo),
            buffer,
            folder
        }, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(JSON.parse(response.fileInfos))
        })
    })
}

export async function copyFile(curUserInfo, originalFileCode, fileInfo, folder = '') {
    /*console.log(ragConfig, ragProto.RagSearch)*/
    let client = new docProto.FileManage(docConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': docConfig.maxMessageLength,
            'grpc.max_receive_message_length': docConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.copyFile({
            originalFileCode,
            operator: curUserInfo,
            fileInfos: JSON.stringify(fileInfo),
            folder
        }, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(JSON.parse(response.fileInfos))
        })
    })
}