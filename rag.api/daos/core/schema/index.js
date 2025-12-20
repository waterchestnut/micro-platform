/**
 * @fileOverview 初始化连接、集成所有mongodb的schema
 * @author xianyang 2024/5/31
 * @module
 */

import mongoose from 'mongoose'
import ragInfoSchema from './ragInfoSchema.js'
import ragMaterialSchema from './ragMaterialSchema.js'
import ragSegmentSchema from './ragSegmentSchema.js'
import ragChunkSchema from './ragChunkSchema.js'

const mongodbConfig = rag.config.mongodbConfig

async function getConnection(config) {
    for (let i = 1; i <= 3; ++i) {
        try {
            return await mongoose.createConnection(config.uri, config.options)
        } catch (err) {
            rag.logger.error(`第${i}次connect to %s error: ${mongodbConfig.uri}，${err.message}`)
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

export const RagInfo = conn.model('RagInfo', ragInfoSchema, 'ragInfo')
export const RagMaterial = conn.model('RagMaterial', ragMaterialSchema, 'ragMaterial')
export const RagSegment = conn.model('RagSegment', ragSegmentSchema, 'ragSegment')
export const RagChunk = conn.model('RagChunk', ragChunkSchema, 'ragChunk')