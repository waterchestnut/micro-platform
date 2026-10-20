/**
 * @fileOverview 长期记忆的向量存储结构
 * @author xianyang 2026-10-18
 * @module
 * @description 记忆走独立 collection 而不是复用 `chunk`：
 * 1. `chunk` 的 ingest 依赖 `ragMaterial.fileList`（实测 `handleSimpleMaterial` 在无 fileList 时直接返回），
 *    记忆是纯文本，硬塞要走"把记忆写成文件"的荒谬路径；
 * 2. 记忆按 `userCode + channel` 硬隔离，检索时必须带这层过滤，混在 `chunk` 里既无索引也易越权；
 * 3. 生命周期不同：记忆会被替代/退役并可完全删除，`chunk` 随材料存在。
 *
 * `daos/milvus/schema/index.js` 会扫描本目录自动建集，放下文件即生效，无需迁移脚本。
 */
import {DataType, IndexType} from '@zilliz/milvus2-sdk-node'

const collection_name = `memory`
/** 与 chunk 同一嵌入模型（bge-m3），维度必须一致，否则 upsert 直接报错 */
const dim = 1024
const schema = [
    {
        name: `memoryCode`,
        description: `记忆标识（llm.api 的 atomCode）`,
        data_type: DataType.VarChar,
        is_primary_key: true,
        autoID: false,
        max_length: 128,
    },
    {
        name: `userCode`,
        description: `归属用户标识，检索必带`,
        data_type: DataType.VarChar,
        max_length: 128,
    },
    {
        name: `channel`,
        description: `频道标识，检索必带`,
        data_type: DataType.VarChar,
        max_length: 64,
    },
    {
        name: `workspaceId`,
        description: `沙箱工作区标识，未启用时为空串`,
        data_type: DataType.VarChar,
        max_length: 128,
    },
    {
        name: `kind`,
        description: `事实类别`,
        data_type: DataType.VarChar,
        max_length: 32,
    },
    {
        name: `topic`,
        description: `主题标签`,
        data_type: DataType.VarChar,
        max_length: 128,
    },
    {
        name: `state`,
        description: `生命周期，退役/被替代不再召回`,
        data_type: DataType.VarChar,
        max_length: 16,
    },
    {
        name: `text`,
        description: `记忆正文，随命中一并返回`,
        data_type: DataType.VarChar,
        max_length: 8192,
    },
    {
        name: `insertTime`,
        description: `创建时间（毫秒时间戳）`,
        data_type: DataType.Int64,
    },
    {
        name: `content`,
        description: `记忆正文向量`,
        data_type: DataType.FloatVector,
        dim: dim,
    },
]

const index = [
    {
        collection_name,
        field_name: 'content',
        index_name: 'i_content',
        index_type: IndexType.HNSW,
        params: {efConstruction: 100, M: 32},
        metric_type: 'L2',
    }
]

export default {
    collection_name,
    schema,
    index
}
