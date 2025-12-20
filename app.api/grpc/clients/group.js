/**
 * @fileOverview 用户中心用户组相关的rpc接口调用
 * @author xianyang
 * @group
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const ucenterConfig = app.config.ucenterConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/group.proto'
const ucenterProto = loadProto(protoPath).ucenter

export async function getGroupList(clientCode) {
    let client = new ucenterProto.Group(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getGroupList({clientCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.groups)
        })
    })
}

export async function saveGroupPrivs(curUserInfo, clientCode, modulePrivCodes, groupCode) {
    let client = new ucenterProto.Group(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.saveGroupPrivs({curUserInfo, clientCode, modulePrivCodes, groupCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.count)
        })
    })
}