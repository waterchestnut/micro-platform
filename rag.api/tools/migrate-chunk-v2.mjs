/**
 * chunk → chunk_v2 混合索引迁移（批75）
 * 背景：hybrid retrieval 需 dense + BM25 sparse 双索引，但 Milvus function 不能加到既有集合，
 *   故新建 chunk_v2（dense 复制旧集合 + text 原文，sparse 由 BM25 function 服务端生成）。
 * 关键降本：dense 从旧 chunk 集合复制，不重新 embed（35 万次省掉）；text 取 mongo ragChunk.content。
 * 用法：cd src; node tools/migrate-chunk-v2.mjs [--ragCode=xxx] [--batch=200] [--dry] [--resume]
 *   --ragCode 只迁某库；--dry 只读不写；--resume 跳过 chunk_v2 已存在的 ragChunkCode（断点续跑）。
 * 幽灵向量（旧集合查不到 dense）跳过并计数，与 ghost-sweep 同口径。
 */
import '../init.js'
import mongoose from 'mongoose'
import {milvusClient} from '../daos/milvus/schema/index.js'
import {upsertItems as upsertItemsV2} from '../daos/milvus/dac/chunkV2Dac.js'

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--(\w+)(?:=(.*))?$/)
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]
}))
const BATCH = parseInt(argv.batch || 200)
const DRY = !!argv.dry

const mc = rag.config.mongodbConfig
const conn = await mongoose.createConnection(
    argv.mongoUri || mc.uri,
    {
        autoIndex: false, dbName: mc.options.dbName,
        user: mc.options.user, pass: mc.options.pass, authSource: mc.options.authSource || 'admin',
    },
).asPromise()

await milvusClient.loadCollectionSync({collection_name: 'chunk'}).catch(() => {})
// 迁移范围：milvus chunk 里 count>0 的库（mongo 有行但未 embed 的 connector 库直接跳过，避免空扫千万幽灵）
async function embeddedRagCodes() {
    const rags = (await conn.db.collection('ragInfo').find({}, {projection: {ragCode: 1}}).toArray()).map(r => r.ragCode)
    const out = []
    for (const rc of rags) {
        const r = await milvusClient.query({collection_name: 'chunk', filter: `ragCode == ${JSON.stringify(rc)}`, output_fields: ['count(*)']}).catch(() => ({data: []}))
        if (Number(r.data?.[0]?.['count(*)'] ?? 0) > 0) out.push(rc)
    }
    return out
}
const libs = argv.ragCode ? [argv.ragCode] : await embeddedRagCodes()
console.log('迁移库:', libs.join(','))

const mongoFilter = {status: {$gte: 0}}
if (argv.ragCode) mongoFilter.ragCode = argv.ragCode
const total = argv.ragCode
    ? await conn.db.collection('ragChunk').countDocuments(mongoFilter)
    : (await Promise.all(libs.map(rc => conn.db.collection('ragChunk').countDocuments({ragCode: rc, status: {$gte: 0}})))).reduce((a, b) => a + b, 0)
console.log(`迁移目标: ragChunk ${total} 条${argv.ragCode ? ' (ragCode=' + argv.ragCode + ')' : ' (仅已 embed 库)'}${DRY ? ' [DRY-RUN]' : ''}`)

// 已迁移集合（--resume 时用于跳过）
let migrated = new Set()
if (argv.resume) {
    // 分页拉 chunk_v2 现有主键
    let off = 0
    while (true) {
        const rows = await milvusClient.query({
            collection_name: 'chunk_v2', filter: 'ragChunkCode != ""',
            output_fields: ['ragChunkCode'], limit: 10000, offset: off,
        }).catch(() => ({data: []}))
        const arr = rows.data || []
        arr.forEach(r => migrated.add(r.ragChunkCode))
        if (arr.length < 10000) break
        off += 10000
    }
    console.log('resume: chunk_v2 已存在', migrated.size, '条，将跳过')
}

const projection = {ragChunkCode: 1, ragCode: 1, ragMaterialCode: 1, ragSegmentCode: 1, language: 1, status: 1, content: 1}
let buf = [], done = 0, ghost = 0, wrote = 0, skipped = 0
const t0 = Date.now()

async function flush(rows) {
    const codes = rows.map(r => r.ragChunkCode)
    // 从旧 chunk 集合复制 dense
    const expr = `ragChunkCode in [${codes.map(c => JSON.stringify(c)).join(',')}]`
    const old = await milvusClient.query({
        collection_name: 'chunk', filter: expr,
        output_fields: ['ragChunkCode', 'content'], limit: codes.length,
    }).catch(e => ({data: [], err: e.message}))
    const denseMap = new Map((old.data || []).map(o => [o.ragChunkCode, o.content]))
    const items = []
    for (const r of rows) {
        const dense = denseMap.get(r.ragChunkCode)
        if (!dense || !dense.length) { ghost++; continue }
        items.push({
            ragChunkCode: r.ragChunkCode, ragCode: r.ragCode || '',
            ragMaterialCode: r.ragMaterialCode || '', ragSegmentCode: r.ragSegmentCode || '',
            language: r.language || '', status: r.status ?? 0,
            text: r.content || '', content: dense,
        })
    }
    if (!items.length) return
    if (DRY) { wrote += items.length; return }
    await upsertItemsV2(items)
    wrote += items.length
}

// 按库迭代（mongoFilter 每库带 ragCode，避免全表扫未 embed 库）
for (const rc of libs) {
    const libFilter = {ragCode: rc, status: {$gte: 0}}
    const cursor = conn.db.collection('ragChunk').find(libFilter, {projection}).batchSize(2000)
    for await (const chunk of cursor) {
        if (migrated.has(chunk.ragChunkCode)) { skipped++; continue }
        buf.push(chunk)
        if (buf.length >= BATCH) {
            await flush(buf)
            done += buf.length
            buf = []
            const el = (Date.now() - t0) / 1000
            console.log(`进度 ${done}/${total} | 写入 ${wrote} 幽灵 ${ghost} 跳过 ${skipped} | ${el.toFixed(0)}s (${(done / el).toFixed(0)}/s) | 库 ${rc}`)
        }
    }
    if (buf.length) { await flush(buf); done += buf.length; buf = [] }
    console.log(`  库 ${rc} 完成，累计写入 ${wrote} 幽灵 ${ghost}`)
}

console.log(`\n完成: 处理 ${done} | 写入 chunk_v2 ${wrote} | 幽灵(无 dense) ${ghost} | resume 跳过 ${skipped} | 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
if (!DRY) {
    const stat = await milvusClient.getCollectionStatistics({collection_name: 'chunk_v2'}).catch(() => ({}))
    console.log('chunk_v2 row_count:', stat.data?.row_count)
}
await conn.close()
process.exit(0)
