/**
 * @fileOverview 用户中心应用相关的rpc接口调用
 * @author xianyang
 * @client
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const ucenterConfig = app.config.ucenterConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/client.proto'
const ucenterProto = loadProto(protoPath).ucenter

export async function saveUcenterClient(curUserInfo, clientInfo) {
    let client = new ucenterProto.Client(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        delete clientInfo.modulePrivCodes
        /*调用远程服务方法*/
        client.saveClient({curUserInfo, clientInfo}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response)
        })
    })
}

export async function getUcenterClient(clientCode) {
    let client = new ucenterProto.Client(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getClient({clientCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response)
        })
    })
}

export async function allocPrivsToOtherClient(curUserInfo, clientCode, modulePrivCodes, toClientCode) {
    let client = new ucenterProto.Client(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.allocPrivs({curUserInfo, clientCode, modulePrivCodes, toClientCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.count)
        })
    })
}

export async function getUcenterClientList(clientCodes) {
    let client = new ucenterProto.Client(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getClientList({clientCodes}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.clients)
        })
    })
}