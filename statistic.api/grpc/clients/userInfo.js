/**
 * @fileOverview 用户相关的rpc接口调用
 * @author xianyang 2025/2/18
 * @module
 */
import grpc from '@grpc/grpc-js';
import {loadProto} from "../utils.js";

const ucenterConfig = statistic.config.ucenterConfig;

// Protocol Buffers文件
const protoPath = 'grpc/clients/userInfo.proto';
const ucenterProto = loadProto(protoPath).ucenter;

export async function getUserDetail(userCode) {
    let client = new ucenterProto.UserInfo(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure());
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getUserDetail({userCode}, function (err, response) {
            if (err) {
                return reject(err);
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response);
        });
    });
}

export async function getUserList(userCodes) {
    let client = new ucenterProto.UserInfo(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure());
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getUserList({userCodes}, function (err, response) {
            if (err) {
                return reject(err);
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.users);
        });
    });
}

export async function hasPriv(userCode, needPrivs) {
    let client = new ucenterProto.UserInfo(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure());
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.hasPriv({userCode, needPrivs}, function (err, response) {
            if (err) {
                return reject(err);
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.hasPriv);
        });
    });
}