/**
 * @fileOverview 材料分句的底层milvus操作
 * @author xianyang 2025/6/27
 * @module
 */
import schemas, {milvusClient} from '../schema/index.js'

const schema = schemas['chunkSchema']

export async function upsertItems(items) {
    await milvusClient.upsert({
        collection_name: schema.collection_name,
        fields_data: items,
    })

    return items.length
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