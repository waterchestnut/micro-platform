/**
 * @fileOverview 初始化连接、集成所有mongodb的schema
 * @author xianyang 2024/5/31
 * @module
 */

import mongoose from 'mongoose'
import agentTaskSchema from './agentTaskSchema.js'
import agentLogSchema from './agentLogSchema.js'
import conversationSchema from './conversationSchema.js'
import messageSchema from './messageSchema.js'
import answerCacheSchema from './answerCacheSchema.js'

const mongodbConfig = llm.config.mongodbConfig

async function getConnection(config) {
    for (let i = 1; i <= 3; ++i) {
        try {
            return await mongoose.createConnection(config.uri, config.options)
        } catch (err) {
            llm.logger.error(`第${i}次connect to %s error: ${mongodbConfig.uri}，${err.message}`)
            if (i >= 3) {
                process.exit(1)
            }
        }
    }
}

/**
 * 连接mongodb并导出Model
 */
const conn = await getConnection(mongodbConfig)

export const AgentTask = conn.model('AgentTask', agentTaskSchema, 'agentTask')
export const AgentLog = conn.model('AgentLog', agentLogSchema, 'agentLog')
export const Conversation = conn.model('Conversation', conversationSchema, 'conversation')
export const Message = conn.model('Message', messageSchema, 'message')
export const AnswerCache = conn.model('AnswerCache', answerCacheSchema, 'answerCache')