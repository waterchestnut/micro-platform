/**
 * @fileOverview 角色授权相关的rpc服务
 * @author xianyang
 * @group
 */
import {
    getGroups,
    updateGroupPrivsByClient
} from '../../services/core/group.js'
import {loadProto} from '../utils.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/group.proto'
const ucenterProto = loadProto(protoPath).ucenter

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ucenterProto.Group.service, {
        saveGroupPrivs: async (call, callback) => {
            try {
                let count = await updateGroupPrivsByClient(call.request.curUserInfo, call.request.clientCode, call.request.groupCode, call.request.modulePrivCodes)
                callback(null, {count})
            } catch (e) {
                callback(e)
            }
        },
        getGroupList: async (call, callback) => {
            try {
                let ret = await getGroups({}, 1, 1000)
                callback(null, {groups: ret?.rows})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}