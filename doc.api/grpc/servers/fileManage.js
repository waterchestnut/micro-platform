/**
 * @fileOverview 文件管理相关的rpc服务
 * @author xianyang
 * @pageConfig
 */

import {loadProto} from '../utils.js'
import {saveFile, copyFile} from '../../services/core/fileInfo.js'
// Protocol Buffers文件
const protoPath = 'grpc/servers/fileManage.proto'
const docProto = loadProto(protoPath).doc

/**
 * 初始化rpc服务方法
 */
export function initService(server) {
    server.addService(docProto.FileManage.service, {
        saveFile: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await saveFile({
                    storeType: 'unique',
                    ...JSON.parse(call.request.fileInfos),
                    fileCode: call.request.fileCode,
                }, JSON.parse(call.request.extInfos), call.request.buffer, call.request.folder, call.request.operator)
                callback(null, {fileInfos: JSON.stringify(ret)})
            } catch (e) {
                callback(e)
            }
        },
        copyFile: async (call, callback) => {
            try {
                /*console.log(call.request)*/
                let ret = await copyFile(call.request.originalFileCode, JSON.parse(call.request.fileInfos), call.request.folder, call.request.operator)
                callback(null, {fileInfos: JSON.stringify(ret)})
            } catch (e) {
                callback(e)
            }
        }
    })

    return server
}