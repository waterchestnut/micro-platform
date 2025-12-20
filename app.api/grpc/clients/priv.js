/**
 * @fileOverview 用户中心权限管理相关的rpc接口调用
 * @author xianyang
 * @priv
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const ucenterConfig = app.config.ucenterConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/priv.proto'
const ucenterProto = loadProto(protoPath).ucenter

export async function getPrivList(clientCode) {
    let client = new ucenterProto.Priv(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getPrivList({clientCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.privs)
        })
    })
}

export async function addPriv(curUserInfo, priv) {
    let client = new ucenterProto.Priv(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.addPriv({curUserInfo, priv}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response)
        })
    })
}

export async function deletePriv(curUserInfo, modulePrivCode) {
    let client = new ucenterProto.Priv(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.deletePriv({curUserInfo, modulePrivCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.deleted)
        })
    })
}