/**
 * @fileOverview 知识库管理相关的rpc服务
 * @author xianyang
 * @pageConfig
 */

import {loadProto} from '../utils.js'
import {checkRagMaterial} from '../../services/core/ragMaterial.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/ragManage.proto'
const ragProto = loadProto(protoPath).rag

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ragProto.RagManage.service, {
        checkMaterial: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let materialInfo = await checkRagMaterial(call.request.operator, {
                    ...JSON.parse(call.request.ragInfos),
                    ragCode: call.request.ragCode,
                    ragType: call.request.ragType
                }, {...JSON.parse(call.request.materials)})
                callback(null, {materials: JSON.stringify(materialInfo)})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}