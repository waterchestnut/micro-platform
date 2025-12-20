/**
 * @fileOverview 用户中心路由权限相关的rpc接口调用
 * @author xianyang
 * @pageConfig
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const ucenterConfig = app.config.ucenterConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/pageConfig.proto'
const ucenterProto = loadProto(protoPath).ucenter

export async function getPageConfig(clientCode) {
    let client = new ucenterProto.PageConfig(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getPageConfig({clientCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.pageConfigs)
        })
    })
}

export async function savePageConfig(curUserInfo, clientCode, pageConfigs) {
    let client = new ucenterProto.PageConfig(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.savePageConfig({curUserInfo, clientCode, pageConfigs}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.count)
        })
    })
}