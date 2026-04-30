/**
 * @fileOverview 存储服务提供商类型
 * @author xianyang
 * @module
 */
import Enumify from '../../../extends/Enumify.js'

export default class StorageProviderEnum extends Enumify {
    static minio = new StorageProviderEnum('minio', 'MinIO对象存储')
    static oss = new StorageProviderEnum('oss', '阿里云OSS对象存储')
    static rustfs = new StorageProviderEnum('rustfs', 'RustFS文件存储')
    static _ = this.closeEnum()
}
