/**
 * @fileOverview 存储适配器工厂，根据provider和storeCode获取对应的适配器
 * @author xianyang
 * @module
 */

import StorageProviderEnum from '../core/enum/StorageProviderEnum.js'
import MinioAdapter from './MinioAdapter.js'
import OssAdapter from './OssAdapter.js'
import RustFsAdapter from './RustFsAdapter.js'

const storageConfig = doc.config.storageConfig
const adapters = {}

function getAdapterClass(provider) {
    switch (provider) {
        case StorageProviderEnum.oss.value:
            return OssAdapter
        case StorageProviderEnum.rustfs.value:
            return RustFsAdapter
        case StorageProviderEnum.minio.value:
        default:
            return MinioAdapter
    }
}

/**
 * @description 获取存储适配器，根据provider和storeCode懒加载创建
 * @param {String} storeProvider 存储提供商 (minio/oss/rustfs)
 * @param {String} storeCode 存储节点编码
 * @returns {StorageAdapter} 存储适配器实例
 */
export function getStorageAdapter(storeProvider = '', storeCode = '') {
    const provider = storeProvider || storageConfig.defaultProvider
    const code = storeCode || storageConfig.providers[provider]?.defaultStoreCode

    if (!storageConfig.providers[provider]) {
        throw new Error(`不支持的存储提供商: ${provider}`)
    }
    if (!storageConfig.providers[provider].stores[code]) {
        throw new Error(`存储节点配置不存在: ${provider}/${code}`)
    }

    const key = `${provider}:${code}`
    if (!adapters[key]) {
        const AdapterClass = getAdapterClass(provider)
        const config = storageConfig.providers[provider].stores[code]
        adapters[key] = new AdapterClass(code, config)
    }
    return adapters[key]
}

/**
 * @description 获取默认存储适配器
 * @returns {StorageAdapter} 默认存储适配器
 */
export function getDefaultAdapter() {
    return getStorageAdapter()
}

/**
 * @description 获取所有已注册的存储适配器
 * @returns {Object} key为'provider:code'的适配器字典
 */
export function getRegisteredAdapters() {
    loadAllAdapters()
    return adapters
}

/**
 * @description 预加载所有配置的存储适配器
 */
export function loadAllAdapters() {
    for (const provider of Object.keys(storageConfig.providers)) {
        const providerConfig = storageConfig.providers[provider]
        for (const storeCode of Object.keys(providerConfig.stores)) {
            getStorageAdapter(provider, storeCode)
        }
    }
    return adapters
}

export {StorageProviderEnum}
