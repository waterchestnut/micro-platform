/**
 * @fileOverview 功能模块相关的rpc服务
 * @author xianyang
 * @module
 */
import {getModules, addModule, deleteModule} from '../../services/core/module.js'
import {loadProto} from '../utils.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/module.proto'
const ucenterProto = loadProto(protoPath).ucenter

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ucenterProto.Module.service, {
        addModule: async (call, callback) => {
            try {
                let module = await addModule(call.request.curUserInfo, call.request.module)
                callback(null, module || {})
            } catch (e) {
                callback(e)
            }
        },
        getModuleList: async (call, callback) => {
            try {
                let ret = await getModules({clientCode: call.request.clientCode}, 1, 1000)
                callback(null, {modules: ret?.rows})
            } catch (e) {
                callback(e)
            }
        },
        deleteModule: async (call, callback) => {
            try {
                await deleteModule(call.request.moduleCode)
                callback(null, {deleted: true})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}