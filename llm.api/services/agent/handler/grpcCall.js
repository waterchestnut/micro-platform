/**
 * @fileOverview grpc服务调用
 * @author xianyang 2025/9/8
 * @module
 */
import BaseHandler from './base.js'
import {execAgentTask} from '../../../grpc/clients/agentExecutor.js'
import {addAgentLog} from '../../core/agentLog.js'

class GrpcCall extends BaseHandler {
    constructor() {
        super('grpc')
    }

    async exec(agentTaskInfo) {
        let taskRet = await execAgentTask(agentTaskInfo, agentTaskInfo.params.grpcHost, (chunkRet) => {
            addAgentLog(agentTaskInfo, chunkRet.logContent, chunkRet.logGroup, chunkRet.logExt)
        })
        return {
            handleStatus: taskRet.handleStatus,
            handleRet: taskRet.handleRet,
            errorMsg: '',
            subsequentMode: '',
            subsequents: []
        }
    }
}

export default GrpcCall
