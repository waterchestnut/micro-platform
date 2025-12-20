/**
 * @fileOverview 路由授权相关的rpc服务
 * @author xianyang
 * @client
 */
import {
    allocPrivsToOtherClient,
    getClientByCode, getClients,
} from '../../services/core/client.js'
import {loadProto} from '../utils.js'
import clientDac from '../../daos/core/dac/clientDac.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/client.proto'
const ucenterProto = loadProto(protoPath).ucenter

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ucenterProto.Client.service, {
        saveClient: async (call, callback) => {
            try {
                let newInfo = {clientCode: call.request.clientInfo.clientCode, status: call.request.clientInfo.status}
                if (call.request.clientInfo?.retUrls?.length > 0) {
                    newInfo.retUrls = call.request.clientInfo.retUrls
                }
                if (call.request.clientInfo?.clientName?.length > 0) {
                    newInfo.clientName = call.request.clientInfo.clientName
                }
                if (call.request.clientInfo?.description?.length > 0) {
                    newInfo.description = call.request.clientInfo.description
                }
                if (call.request.clientInfo?.clientSecret?.length > 0) {
                    newInfo.clientSecret = call.request.clientInfo.clientSecret
                }
                if (call.request.clientInfo?.tags?.length > 0) {
                    newInfo.tags = call.request.clientInfo.tags
                }
                let info = await clientDac.upsert(newInfo)
                callback(null, info || {})
            } catch (e) {
                callback(e)
            }
        },
        getClient: async (call, callback) => {
            try {
                let ret = await getClientByCode(call.request.clientCode)
                callback(null, ret || {})
            } catch (e) {
                callback(e)
            }
        },
        allocPrivs: async (call, callback) => {
            try {
                let ret = await allocPrivsToOtherClient(call.request.curUserInfo, call.request.clientCode, call.request.toClientCode, call.request.modulePrivCodes)
                callback(null, {count: ret})
            } catch (e) {
                callback(e)
            }
        },
        getClientList: async (call, callback) => {
            try {
                let ret = await getClients({clientCode: call.request.clientCodes}, 1, 2000)
                callback(null, {clients: ret?.rows || []})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}