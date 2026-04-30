/**
 * @fileOverview 阿里云OSS存储适配器
 * @author xianyang
 * @module
 */

import OSS from 'ali-oss'
import StorageAdapter from './StorageAdapter.js'
import {Readable} from 'node:stream'

export default class OssAdapter extends StorageAdapter {
    constructor(storeCode, config) {
        super(storeCode, 'oss')
        this.bucketName = config.bucket
        this.client = new OSS({
            region: config.region,
            accessKeyId: config.accessKeyId,
            accessKeySecret: config.accessKeySecret,
            bucket: config.bucket,
            endpoint: config.endpoint,
            internal: config.internal || false,
        })
    }

    async putObject(bucketName, filePath, buffer, size, metadata) {
        const options = {
            headers: {},
        }
        if (metadata) {
            for (const [key, value] of Object.entries(metadata)) {
                options.headers[`x-oss-meta-${key.toLowerCase()}`] = String(value)
            }
            if (metadata['Content-Type']) {
                options.headers['Content-Type'] = metadata['Content-Type']
            }
        }
        if (size) {
            options.contentLength = size
        }
        return this.client.put(filePath, buffer, options)
    }

    async getObject(bucketName, filePath) {
        const result = await this.client.get(filePath)
        return Readable.from(result.content)
    }

    async copyObject(bucketName, destPath, sourcePath) {
        return this.client.copy(destPath, sourcePath.replace(`/${this.bucketName}/`, ''))
    }

    async statObject(bucketName, filePath) {
        const result = await this.client.head(filePath)
        return {
            size: parseInt(result.res.headers['content-length'] || '0'),
            metaData: result.res.headers,
        }
    }

    async deleteObject(bucketName, filePath) {
        return this.client.delete(filePath)
    }

    async createBucket(bucketName) {
        try {
            return await this.client.putBucket(bucketName || this.bucketName)
        } catch (err) {
            throw err
        }
    }
}
