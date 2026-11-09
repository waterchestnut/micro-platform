/**
 * milvus 幽灵向量清扫（chunk 集合）
 * 背景：材料删除时 milvus deleteByQuery 失败（历史 .catch 吞失败）或运维直连 mongo 批量软删
 * 未触及 milvus → 向量残留。检索本身会按 mongo 软删态过滤，但这些 distance≈0 的幽灵
 * 会顶满 top-K，把真正的新内容挤出候选（现象=固定文本重插后"搜不到"，曾被误判为内容去重）。
 * 用法：cd src; node tools/milvus-ghost-sweep.mjs
 */
import '../init.js'
import mongoose from 'mongoose'
import {deleteByQuery} from '../daos/milvus/dac/chunkDac.js'
import {milvusClient} from '../daos/milvus/schema/index.js'

const conn = await mongoose.createConnection('mongodb://mongo7-124:27017/xxzx-rag-api', {
    autoIndex: false, user: 'localuser', pass: 'yopit123', authSource: 'admin',
}).asPromise()

const dead = (await conn.db.collection('ragMaterial').find({status: -1}, {projection: {ragMaterialCode: 1}}).toArray())
    .map(m => m.ragMaterialCode)
console.log('dead materials:', dead.length)

let totalDel = 0
for (let i = 0; i < dead.length; i += 50) {
    const batch = dead.slice(i, i + 50)
    const expr = `ragMaterialCode in [${batch.map(c => JSON.stringify(c)).join(',')}]`
    const cnt = await deleteByQuery({filter: expr})
    totalDel += Number(cnt) || 0
    console.log(`batch ${Math.floor(i / 50) + 1}: deleted ${cnt}`)
}
console.log('milvus ghost vectors deleted:', totalDel)

try {
    const live = await conn.db.collection('ragChunk').countDocuments({status: {$gte: 0}})
    const stat = await milvusClient.getStats({collection_name: 'chunk'})
    console.log('after sweep → mongo live chunks:', live, '| milvus chunk row_count:', stat.data?.row_count)
} catch (e) { console.log('stats check skipped:', String(e.message).slice(0, 80)) }

await conn.close()
process.exit(0)
