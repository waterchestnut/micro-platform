/**
 * @fileOverview 用户中心模块相关的rpc接口调用
 * @author xianyang
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const ucenterConfig = app.config.ucenterConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/module.proto'
const ucenterProto = loadProto(protoPath).ucenter

export async function getModuleList(clientCode) {
    let client = new ucenterProto.Module(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getModuleList({clientCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.modules)
        })
    })
}

export async function addModule(curUserInfo, module) {
    let client = new ucenterProto.Module(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.addModule({curUserInfo, module}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response)
        })
    })
}

export async function deleteModule(curUserInfo, moduleCode) {
    let client = new ucenterProto.Module(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.deleteModule({curUserInfo, moduleCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.deleted)
        })
    })
}