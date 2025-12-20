/**
 * @fileOverview 功能权限相关的rpc服务
 * @author xianyang
 * @modulePriv
 */
import {getModulePrivs, addModulePriv, deleteModulePriv} from '../../services/core/modulePriv.js'
import {loadProto} from '../utils.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/priv.proto'
const ucenterProto = loadProto(protoPath).ucenter

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ucenterProto.Priv.service, {
        addPriv: async (call, callback) => {
            try {
                let modulePriv = await addModulePriv(call.request.curUserInfo, call.request.priv)
                callback(null, modulePriv || {})
            } catch (e) {
                callback(e)
            }
        },
        getPrivList: async (call, callback) => {
            try {
                let ret = await getModulePrivs({clientCode: call.request.clientCode}, 1, 3000, {withFormat: 1})
                callback(null, {privs: ret?.rows})
            } catch (e) {
                callback(e)
            }
        },
        deletePriv: async (call, callback) => {
            try {
                await deleteModulePriv(call.request.modulePrivCode)
                callback(null, {deleted: true})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}