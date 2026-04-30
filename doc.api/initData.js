/**
 * @fileOverview 初始化数据（创建各存储提供商的bucket/namespace）
 * @author xianyang
 * @module
 */

import './init.js'
import {getRegisteredAdapters} from './daos/storage/factory.js'

let adapters = getRegisteredAdapters()
for (let key in adapters) {
    let adapter = adapters[key]
    try {
        await adapter.createBucket(adapter.bucketName || adapter.namespace)
        console.log(`[${key}] bucket/namespace created successfully`)
    } catch (err) {
        console.error(`[${key}] failed to create bucket:`, err.message)
        throw err
    }
}

console.log('done')
process.exit(0)
