/**
 * @fileOverview MinIO存储适配器
 * @author xianyang
 * @module
 */

import {Client} from 'minio'
import StorageAdapter from './StorageAdapter.js'

export default class MinioAdapter extends StorageAdapter {
    constructor(storeCode, config) {
        super(storeCode, 'minio')
        this.bucketName = config.bucketName
        this.client = new Client({
            endPoint: config.endPoint,
            port: config.port,
            useSSL: config.useSSL,
            accessKey: config.accessKey,
            secretKey: config.secretKey,
        })
    }

    async putObject(bucketName, filePath, buffer, size, metadata) {
        return this.client.putObject(bucketName || this.bucketName, filePath, buffer, size, metadata)
    }

    async getObject(bucketName, filePath) {
        return this.client.getObject(bucketName || this.bucketName, filePath)
    }

    async copyObject(bucketName, destPath, sourcePath) {
        return this.client.copyObject(bucketName || this.bucketName, destPath, sourcePath)
    }

    async statObject(bucketName, filePath) {
        return this.client.statObject(bucketName || this.bucketName, filePath)
    }

    async deleteObject(bucketName, filePath) {
        return this.client.removeObject(bucketName || this.bucketName, filePath)
    }

    async createBucket(bucketName) {
        try {
            return await this.client.makeBucket(bucketName || this.bucketName)
        } catch (err) {
            if (err.code === 'BucketAlreadyOwnedByYou') {
                return
            }
            throw err
        }
    }
}
