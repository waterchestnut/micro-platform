/**
 * @fileOverview 知识库检索相关的rpc服务
 * @author xianyang
 * @pageConfig
 */

import {loadProto} from '../utils.js'
import {ragSearch, simpleResRagSearch} from '../../services/core/ragSearch.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/ragSearch.proto'
const ragProto = loadProto(protoPath).rag

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ragProto.RagSearch.service, {
        ragSearch: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await ragSearch(call.request.subject, JSON.parse(call.request.options))
                callback(null, {contentItems: ret})
            } catch (e) {
                callback(e)
            }
        },
        simpleResRag: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await simpleResRagSearch(call.request.subject, call.request.resCode, call.request.ragMaterialCode, call.request.fileHashCode, call.request.maxTokens, JSON.parse(call.request.options))
                callback(null, {segList: ret})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}