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
            fields: schema.schema,
            ...(schema.functions?.length ? {functions: schema.functions} : {}),
        })
    }
    if (schema.index?.length > 0) {
        for (let i = 0; i < schema.index.length; i++) {
            await milvusClient.createIndex(schema.index[i])
        }
    }
    await milvusClient.loadCollectionSync({
        collection_name: schema.collection_name,
        // milvus 2.6 服务端缺省 3 副本，standalone 仅 1 streaming node 会拒绝；
        // 显式 env 驱动（MILVUS_REPLICA_NUMBER），缺省 1 兼容 standalone/cluster
        replica_number: parseInt(config.milvusConfig.options.replicaNumber || '1'),
    })
}

export default schemas