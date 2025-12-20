/**
 * @fileOverview 资源管理相关的rpc服务
 * @author xianyang
 * @pageConfig
 */

import {loadProto} from '../utils.js'
import {execResRag} from '../../services/rag/resource.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/resourceRag.proto'
const resourceProto = loadProto(protoPath).resource

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(resourceProto.ResourceRag.service, {
        llmRagSearch: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await execResRag(call.request.query, {
                    ...JSON.parse(call.request.options),
                    resCode: call.request.resCode
                })
                callback(null, {
                    segments: ret.map(_ => {
                        const content = _.content
                        delete _.content
                        return {
                            content,
                            metas: JSON.stringify(_)
                        }
                    })
                })
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}