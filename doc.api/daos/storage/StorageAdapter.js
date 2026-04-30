/**
 * @fileOverview 存储适配器抽象基类，定义统一的存储操作接口
 * @author xianyang
 * @module
 */

export default class StorageAdapter {
    constructor(storeCode, storeProvider) {
        this.storeCode = storeCode
        this.storeProvider = storeProvider
    }

    /**
     * @description 上传文件到存储
     * @param {String} bucketName 桶/命名空间
     * @param {String} filePath 文件路径
     * @param {Buffer} buffer 文件内容
     * @param {Number} size 文件大小
     * @param {Object} metadata 元数据
     * @returns {Promise<void>}
     */
    async putObject(bucketName, filePath, buffer, size, metadata) {
        throw new Error('putObject method not implemented')
    }

    /**
     * @description 从存储获取文件流
     * @param {String} bucketName 桶/命名空间
     * @param {String} filePath 文件路径
     * @returns {Promise<Stream>} 文件可读流
     */
    async getObject(bucketName, filePath) {
        throw new Error('getObject method not implemented')
    }

    /**
     * @description 复制文件
     * @param {String} bucketName 桶/命名空间
     * @param {String} destPath 目标路径
     * @param {String} sourcePath 源路径
     * @returns {Promise<void>}
     */
    async copyObject(bucketName, destPath, sourcePath) {
        throw new Error('copyObject method not implemented')
    }

    /**
     * @description 获取文件元数据
     * @param {String} bucketName 桶/命名空间
     * @param {String} filePath 文件路径
     * @returns {Promise<Object>} 文件状态信息
     */
    async statObject(bucketName, filePath) {
        throw new Error('statObject method not implemented')
    }

    /**
     * @description 删除文件
     * @param {String} bucketName 桶/命名空间
     * @param {String} filePath 文件路径
     * @returns {Promise<void>}
     */
    async deleteObject(bucketName, filePath) {
        throw new Error('deleteObject method not implemented')
    }

    /**
     * @description 创建桶/命名空间
     * @param {String} bucketName 桶名
     * @returns {Promise<void>}
     */
    async createBucket(bucketName) {
        throw new Error('createBucket method not implemented')
    }
}
