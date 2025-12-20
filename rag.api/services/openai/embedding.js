/**
 * @fileOverview 向量模型相关的操作
 * @author xianyang 2025/6/30
 * @module
 */
import OpenAI from 'openai'

const tools = rag.tools
const logger = rag.logger
const config = rag.config

/**
 * @description 计算文本向量
 * @author xianyang
 * @param {String[]|String} contents 文本片段
 * @param {Function} [callback] 文本片段过多时，每处理一批就立即调用callback返回一批，此模式下最终的返回列表就不再提供。
 * @param {String} provider 向量提供者的配置节点
 * @returns {Promise<Array>} 向量列表
 */
export async function getContentVector(contents, callback = null, provider = '') {
    let embeddingConfig
    if (provider) {
        embeddingConfig = config.embedding.find(_ => _.provider === provider)
    } else {
        embeddingConfig = config.embedding.find(_ => _.isDefault)
    }
    if (!embeddingConfig) {
        throw Error(`No embedding config found for provider: ${provider}`)
    }
    const openai = new OpenAI({
        apiKey: embeddingConfig.apiKey,
        baseURL: embeddingConfig.baseURL,
    })

    async function execVector(contents) {
        let ret = await openai.embeddings.create({
            model: embeddingConfig.model,
            input: contents,
            encoding_format: embeddingConfig.encoding_format,
            dimensions: embeddingConfig.dimensions
        })
        /*console.log(contents, JSON.stringify(ret))*/
        if (!ret.data.length) {
            return []
        }
        return ret.data.map(_ => _.embedding)
    }

    try {
        if (contents.length <= 10) {
            return await execVector(contents)
        }

        let index = 0
        let rets = []

        while (index < contents.length) {
            let list = await execVector(contents.slice(index, index += 10))
            if (callback) {
                await callback(list)
            } else {
                rets = rets.concat(list)
            }
        }
        return rets
    } catch (e) {
        console.error(contents)
        throw e
    }
}