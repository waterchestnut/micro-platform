/**
 * @fileOverview 用户相关的rpc服务
 * @author xianyang 2025/2/18
 * @module
 */
import {getUserDetail, getUserList, getUserPrivs} from "../../services/core/userInfo.js";
import * as authService from "../../services/auth/index.js";
import {loadProto} from "../utils.js";
// Protocol Buffers文件
const protoPath = 'grpc/servers/userInfo.proto';
const ucenterProto = loadProto(protoPath).ucenter;

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ucenterProto.UserInfo.service, {
        getUserDetail: async (call, callback) => {
            try {
                let userInfo = await getUserDetail(call.request.userCode);
                callback(null, userInfo || {});
            } catch (e) {
                callback(e);
            }
        },
        getUserList: async (call, callback) => {
            try {
                let ret = await getUserList({userCodes: call.request.userCodes}, 1, call.request.userCodes?.length || 1);
                callback(null, {users: ret?.rows});
            } catch (e) {
                callback(e);
            }
        },
        hasPriv: async (call, callback) => {
            try {
                let userPrivs = await getUserPrivs(call.request.userCode);
                let hasPriv = authService.hasPriv(call.request.needPrivs, userPrivs);
                /*console.log(hasPriv,userPrivs,call.request);*/
                callback(null, {hasPriv});
            } catch (e) {
                callback(e);
            }
        }
    });

    return server;
}