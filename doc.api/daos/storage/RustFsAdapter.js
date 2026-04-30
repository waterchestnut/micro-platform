/**
 * @fileOverview RustFS存储适配器（基于HTTP REST接口）
 * @author xianyang
 * @module
 */

import fetch from 'node-fetch'
import StorageAdapter from './StorageAdapter.js'
import {Readable} from 'node:stream'

export default class RustFsAdapter extends StorageAdapter {
    constructor(storeCode, config) {
        super(storeCode, 'rustfs')
        this.endpoint = config.endpoint.replace(/\/+$/, '')
        this.accessKey = config.accessKey
        this.secretKey = config.secretKey
        this.namespace = config.namespace
    }

    _headers(extra = {}) {
        return {
            'Authorization': `Bearer ${this.accessKey}:${this.secretKey}`,
            'Content-Type': 'application/octet-stream',
            ...extra,
        }
    }

    _path(name) {
        return `${this.endpoint}/${this.namespace}/${name.replace(/^\//, '')}`
    }

    async putObject(bucketName, filePath, buffer, size, metadata) {
        const headers = this._headers(metadata?.headers || {})
        if (size) {
            headers['Content-Length'] = String(size)
        }
        const response = await fetch(this._path(filePath), {
            method: 'PUT',
            headers,
            body: buffer,
        })
        if (!response.ok) {
            throw new Error(`RustFS putObject failed: ${response.status} ${response.statusText}`)
        }
    }

    async getObject(bucketName, filePath) {
        const response = await fetch(this._path(filePath), {
            method: 'GET',
            headers: this._headers(),
        })
        if (!response.ok) {
            throw new Error(`RustFS getObject failed: ${response.status} ${response.statusText}`)
        }
        return Readable.from(response.body)
    }

    async copyObject(bucketName, destPath, sourcePath) {
        const sourceFullPath = `/${this.namespace}/${sourcePath.replace(/^\//, '').replace(`${this.namespace}/`, '')}`
        const response = await fetch(this._path(destPath), {
            method: 'PUT',
            headers: this._headers({
                'x-rustfs-copy-from': sourceFullPath,
            }),
        })
        if (!response.ok) {
            throw new Error(`RustFS copyObject failed: ${response.status} ${response.statusText}`)
        }
    }

    async statObject(bucketName, filePath) {
        const response = await fetch(this._path(filePath), {
            method: 'HEAD',
            headers: this._headers(),
        })
        if (!response.ok) {
            throw new Error(`RustFS statObject failed: ${response.status} ${response.statusText}`)
        }
        return {
            size: parseInt(response.headers.get('content-length') || '0'),
            metaData: Object.fromEntries(response.headers.entries()),
        }
    }

    async deleteObject(bucketName, filePath) {
        const response = await fetch(this._path(filePath), {
            method: 'DELETE',
            headers: this._headers(),
        })
        if (!response.ok) {
            throw new Error(`RustFS deleteObject failed: ${response.status} ${response.statusText}`)
        }
    }

    async createBucket(bucketName) {
        const response = await fetch(`${this.endpoint}/${bucketName || this.namespace}`, {
            method: 'POST',
            headers: this._headers(),
        })
        if (!response.ok && response.status !== 409) {
            throw new Error(`RustFS createBucket failed: ${response.status} ${response.statusText}`)
        }
    }
}
