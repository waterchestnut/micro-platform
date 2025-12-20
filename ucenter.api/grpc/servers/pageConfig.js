/**
 * @fileOverview 路由授权相关的rpc服务
 * @author xianyang
 * @pageConfig
 */
import {
    getPageConfigList,
    updateByClient
} from '../../services/core/pageConfig.js'
import {loadProto} from '../utils.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/pageConfig.proto'
const ucenterProto = loadProto(protoPath).ucenter

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ucenterProto.PageConfig.service, {
        savePageConfig: async (call, callback) => {
            try {
                await updateByClient(call.request.curUserInfo, call.request.clientCode, call.request.pageConfigs)
                callback(null, {count: call.request.pageConfigs?.length})
            } catch (e) {
                callback(e)
            }
        },
        getPageConfig: async (call, callback) => {
            try {
                let ret = await getPageConfigList({clientCode: call.request.clientCode}, 1, 1000, {sort: {orderNum: 1}})
                callback(null, {pageConfigs: ret?.rows})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}