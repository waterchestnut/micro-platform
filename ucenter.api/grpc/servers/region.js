/**
 * @fileOverview 区域相关的rpc服务
 * @author xianyang
 * @module
 */

import {loadProto} from '../utils.js'
import * as regionLogic from '../../services/core/region.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/region.proto'
const ucenterProto = loadProto(protoPath).ucenter

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(ucenterProto.Region.service, {
        searchRegion: async (call, callback) => {
            try {
                let regions = await regionLogic.searchParents(call.request.regionName, call.request.levelNum)
                callback(null, {regions: JSON.stringify(regions)})
            } catch (e) {
                callback(e)
            }
        },
    })

    return server
}