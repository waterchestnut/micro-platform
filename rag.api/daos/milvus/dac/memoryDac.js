/**
 * @fileOverview 长期记忆的底层 milvus 操作
 * @author xianyang 2026-10-18
 * @module
 */
import schemas, {milvusClient} from '../schema/index.js'

const schema = schemas['memorySchema']

export async function upsertItems(items) {
    await milvusClient.upsert({
        collection_name: schema.collection_name,
        fields_data: items,
    })
    return items.length
}

export async function deleteByCodes(codes) {
    if (!codes?.length) {
        return 0
    }
    let res = await milvusClient.delete({
        collection_name: schema.collection_name,
        filter: `memoryCode in ${JSON.stringify(codes)}`,
    })
    return res?.delete_cnt
}

export async function deleteByQuery(params) {
    let res = await milvusClient.delete({
        ...params,
        collection_name: schema.collection_name,
    })
    return res?.delete_cnt
}

export async function query(params) {
    let res = await milvusClient.query({
        ...params,
        collection_name: schema.collection_name,
    })
    return res?.data || []
}

export async function search(params) {
    let res = await milvusClient.search({
        ...params,
        collection_name: schema.collection_name,
    })
    return res?.results || []
}

export const memoryCollectionName = schema.collection_name
