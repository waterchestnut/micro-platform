/**
 * @fileOverview 用户相关的rpc接口调用
 * @author xianyang 2025/2/18
 * @module
 */
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'

const ucenterConfig = llm.config.ucenterConfig

// Protocol Buffers文件
const protoPath = 'grpc/clients/userInfo.proto'
const ucenterProto = loadProto(protoPath).ucenter

/**
 * gRPC 的硬截止（deadline）。
 * 为什么必须有：`mentorContact` 的 fail-closed 依赖"调用出错"这一件事，
 * 而 grpc-js 在**不给 deadline 时是无限等**——ucenter 挂住（连接建立了但服务不返回）
 * 既不 resolve 也不 reject，于是一次发消息可以永久卡死在关系校验上。
 * **没有截止的 fail-closed 等于 fail-never。**
 * 这里只对 u2u 热路径（下面两个 mentor 方法）加截止：其余方法的超时语义会改变既有调用方的
 * 行为，不在本次改动里顺手做（见 §25 v1.24 的"先钉现状"纪律）。
 */
const GRPC_DEADLINE_MS = Number(ucenterConfig.grpcTimeoutMs || 3000)

/**
 * @description 带截止的单次 unary 调用，把 grpc-js 的四参形态固定下来（也便于用假 client 验证）
 * @param {Object} client grpc 生成的 client 实例
 * @param {String} methodName 远程方法名
 * @param {Object} request 请求对象
 * @param {Number} [timeoutMs] 截止时长
 * @param {Number} [now] 注入的"当前时间"，仅用于测试
 * @returns {Promise<Object>} 响应
 */
export function callWithDeadline(client, methodName, request, timeoutMs = GRPC_DEADLINE_MS, now = Date.now()) {
    return new Promise((resolve, reject) => {
        client[methodName](request, new grpc.Metadata(), {deadline: new Date(now + timeoutMs)},
            (err, response) => (err ? reject(err) : resolve(response)))
    })
}

/**
 * @description 从响应里取工号列表（缺失或空都算空集合，不报错）
 * @param {Object} response 响应
 * @returns {String[]} 工号列表
 */
export function pickUserCodes(response) {
    return response?.userCodes || []
}

export async function getUserDetail(userCode) {
    let client = new ucenterProto.UserInfo(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': ucenterConfig.maxMessageLength,
            'grpc.max_receive_message_length': ucenterConfig.maxMessageLength,
        })
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getUserDetail({userCode}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response)
        })
    })
}

export async function getUserList(userCodes) {
    let client = new ucenterProto.UserInfo(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.getUserList({userCodes}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.users)
        })
    })
}

export async function hasPriv(userCode, needPrivs) {
    let client = new ucenterProto.UserInfo(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    return new Promise((resolve, reject) => {
        /*调用远程服务方法*/
        client.hasPriv({userCode, needPrivs}, function (err, response) {
            if (err) {
                return reject(err)
            }
            /*console.log('grpc ret:', response);*/
            return resolve(response.hasPriv)
        })
    })
}

/**
 * @description 取某人名下可联系的学生工号列表（PR-R0，导师体系）
 * @param {String} userCode 查询主体工号（只能是当前登录用户，见 D61③）
 * @returns {Promise<String[]>} 学生工号列表
 */
export async function getMentorStudents(userCode) {
    let client = new ucenterProto.UserInfo(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    const response = await callWithDeadline(client, 'getMentorStudents', {userCode})
    return pickUserCodes(response)
}

/**
 * @description 取某人的导师工号列表（个人导师/绑定导师/班级导师合并去重）
 * @param {String} userCode 查询主体工号（只能是当前登录用户，见 D61③）
 * @returns {Promise<String[]>} 导师工号列表
 */
export async function getMentorTeachers(userCode) {
    let client = new ucenterProto.UserInfo(ucenterConfig.grpcHost,
        grpc.credentials.createInsecure())
    const response = await callWithDeadline(client, 'getMentorTeachers', {userCode})
    return pickUserCodes(response)
}