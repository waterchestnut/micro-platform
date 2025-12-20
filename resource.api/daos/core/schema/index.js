/**
 * @fileOverview 初始化连接、集成所有mongodb的schema
 * @author xianyang 2024/5/31
 * @module
 */

import mongoose from 'mongoose'
import doubanBookSchema from './doubanBookSchema.js'
import patentSchema from './patentSchema.js'
import resInfoSchema from './resInfoSchema.js'
import standardSchema from './standardSchema.js'
import datasetSchema from './datasetSchema.js'

const mongodbConfig = resource.config.mongodbConfig

async function getConnection(config) {
    for (let i = 1; i <= 3; ++i) {
        try {
            return await mongoose.createConnection(config.uri, config.options)
        } catch (err) {
            resource.logger.error(`第${i}次connect to %s error: ${mongodbConfig.uri}，${err.message}`)
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

export const ResInfo = conn.model('ResInfo', resInfoSchema, 'resInfo')
export const DoubanBook = conn.model('DoubanBook', doubanBookSchema, 'doubanBook')
export const Patent = conn.model('Patent', patentSchema, 'patent')
export const Standard = conn.model('Standard', standardSchema, 'standard')
export const Dataset = conn.model('Dataset', datasetSchema, 'dataset')