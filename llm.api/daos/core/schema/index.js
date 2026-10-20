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
import grpcSkillSchema from './grpcSkillSchema.js'
import memoryEventSchema from './memoryEventSchema.js'
import memoryCandidateSchema from './memoryCandidateSchema.js'
import memoryAtomSchema from './memoryAtomSchema.js'
import memoryEntitySchema from './memoryEntitySchema.js'
import memoryJournalSchema from './memoryJournalSchema.js'
import memoryProfileSchema from './memoryProfileSchema.js'
import memoryNamespaceSchema from './memoryNamespaceSchema.js'
import sessionCheckpointSchema from './sessionCheckpointSchema.js'
import sandboxUsageSchema from './sandboxUsageSchema.js'

const mongodbConfig = llm.config.mongodbConfig

async function getConnection(config) {
    for (let i = 1; i <= 3; ++i) {
        try {
            return await mongoose.createConnection(config.uri, config.options).asPromise()
        } catch (err) {
            llm.logger.error(`第${i}次connect to %s error: ${mongodbConfig.uri}，${err.message}`)
            if (i >= 3) {
                process.exit(1)
            }
            await new Promise(resolve => setTimeout(resolve, 2000 * i))
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
export const GrpcSkill = conn.model('GrpcSkill', grpcSkillSchema, 'grpcSkill')
export const MemoryEvent = conn.model('MemoryEvent', memoryEventSchema, 'memoryEvent')
export const MemoryCandidate = conn.model('MemoryCandidate', memoryCandidateSchema, 'memoryCandidate')
export const MemoryAtom = conn.model('MemoryAtom', memoryAtomSchema, 'memoryAtom')
export const MemoryEntity = conn.model('MemoryEntity', memoryEntitySchema, 'memoryEntity')
export const MemoryJournal = conn.model('MemoryJournal', memoryJournalSchema, 'memoryJournal')
export const MemoryProfile = conn.model('MemoryProfile', memoryProfileSchema, 'memoryProfile')
export const MemoryNamespace = conn.model('MemoryNamespace', memoryNamespaceSchema, 'memoryNamespace')
export const SessionCheckpoint = conn.model('SessionCheckpoint', sessionCheckpointSchema, 'sessionCheckpoint')
export const SandboxUsage = conn.model('SandboxUsage', sandboxUsageSchema, 'sandboxUsage')