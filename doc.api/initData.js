/**
 * @fileOverview 初始化数据
 * @author xianyang
 * @module
 */

import './init.js'
import {loadClients} from './daos/minio/minioClient.js'

// minio：创建bucket
let clients = loadClients()
for (let key in clients) {
    let minioClient = clients[key]
    try {
        await minioClient.makeBucket(minioClient.bucketName)
    } catch (err) {
        if (err.code === 'BucketAlreadyOwnedByYou') {
            continue
        }
        throw err
    }
}

console.log('done')
process.exit(0)
