/**
 * @fileOverview 资源管理相关的rpc服务
 * @author xianyang
 * @pageConfig
 */

import {loadProto} from '../utils.js'
import {saveResInfo} from '../../services/core/resInfo.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/resourceManage.proto'
const resourceProto = loadProto(protoPath).resource

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(resourceProto.ResourceManage.service, {
        saveResource: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await saveResInfo(call.request.operator, call.request.resCode, JSON.parse(call.request.resInfos))
                callback(null, {count: ret})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}