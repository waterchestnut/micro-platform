/**
 * @fileOverview 统一输出milvus的结构定义
 * @author xianyang 2025/6/27
 * @module
 */
import fs from 'fs'
import {MilvusClient} from '@zilliz/milvus2-sdk-node'

const tools = rag.tools
const config = rag.config

export const milvusClient = new MilvusClient({
    address: config.milvusConfig.address,
    username: config.milvusConfig.options.username,
    password: config.milvusConfig.options.password,
})
await milvusClient.use({db_name: config.milvusConfig.options.dbName})

const schemas = {}
let path = rag.baseDir + 'daos/milvus/schema'
let files = fs.readdirSync(path)
for (let file of files) {
    if (~file.indexOf('Schema.js')) {
        let fileName = file.substring(0, file.indexOf('.js'))
        schemas[fileName] = (await import('./' + file)).default
    }
}

for (let key in schemas) {
    let schema = schemas[key]
    if (!(await milvusClient.hasCollection({collection_name: schema.collection_name}))?.value) {
        await milvusClient.createCollection({
            collection_name: schema.collection_name,
            fields: schema.schema
        })
    }
    if (schema.index?.length > 0) {
        for (let i = 0; i < schema.index.length; i++) {
            await milvusClient.createIndex(schema.index[i])
        }
    }
    await milvusClient.loadCollectionSync({
        collection_name: schema.collection_name,
    })
}

export default schemas