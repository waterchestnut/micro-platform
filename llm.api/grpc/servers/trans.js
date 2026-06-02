/**
 * @fileOverview 大模型翻译相关的rpc服务
 * @author xianyang
 * @pageConfig
 */

import {loadProto} from '../utils.js'
import {autoTrans, nonChineseTrans} from '../../services/core/trans.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/trans.proto'
const llmProto = loadProto(protoPath).llm

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(llmProto.Trans.service, {
        autoTrans: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await autoTrans(call.request.sourceText)
                callback(null, {transText: ret})
            } catch (e) {
                callback(e)
            }
        },
        nonChineseTrans: async (call, callback) => {
            try {
                let ret = await nonChineseTrans(call.request.sourceText, {onlyFull: call.request.onlyFull})
                callback(null, ret)
            } catch (e) {
                callback(e)
            }
        },
    })

    return server
}