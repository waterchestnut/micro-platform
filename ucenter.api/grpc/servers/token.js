/**
 * @fileOverview token相关的rpc服务
 * @author xianyang
 * @moduleToken
 */
import * as accessTokenService from '../../services/core/accessToken.js'
import {loadProto} from '../utils.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/token.proto'
const ucenterProto = loadProto(protoPath).ucenter

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ucenterProto.Token.service, {
        addAccessToken: async (call, callback) => {
            try {
                let tokenInfo = await accessTokenService.addAccessToken(call.request.userCode, call.request.expiresTime, JSON.parse(call.request.extInfo || '{}'))
                callback(null, tokenInfo || {})
            } catch (e) {
                callback(e)
            }
        },
    })

    return server
}