/**
 * @fileOverview 知识库材料分句的混合检索向量存储结构（dense + BM25 sparse）
 * @module
 * @description 与 `chunk`（纯 dense）并行的新集合，用于 hybrid retrieval：
 *   1. 保留 dense `content`（bge-m3 1024 维，语义召回）；
 *   2. 新增 `text`（分句原文，jieba 中文分词）+ `sparse`（Milvus 2.5 原生 BM25 function 从 text 生成，词面召回）；
 *   3. 检索时 dense ANN + BM25 双路 → RRF 融合 → cross-encoder 精排 → 阈值。
 *   治的是纯 dense 的词面盲区（专名/文号/跨语言精确词被样板语料挤出召回窗，见批74 probe-fu-11 取证）。
 *   由 `hybrid.enabled` 开关切换，关闭时检索仍走 `chunk`，行为零变化。
 * @doc Milvus 2.5 native full-text search (BM25) + jieba analyzer
 */
import {DataType, IndexType, FunctionType, MetricType} from '@zilliz/milvus2-sdk-node'

const collection_name = `chunk_v2`
const dim = 1024

const schema = [
    {
        name: `ragChunkCode`,
        description: `分句标识`,
        data_type: DataType.VarChar,
        is_primary_key: true,
        autoID: false,
        max_length: 128,
    },
    {
        name: `ragCode`,
        description: `知识库标识`,
        data_type: DataType.VarChar,
        max_length: 128,
    },
    {
        name: `ragMaterialCode`,
        description: `材料标识`,
        data_type: DataType.VarChar,
        max_length: 128,
    },
    {
        name: `ragSegmentCode`,
        description: `分段标识`,
        data_type: DataType.VarChar,
        max_length: 128,
    },
    {
        name: `language`,
        description: `材料的语言`,
        data_type: DataType.VarChar,
        max_length: 64,
    },
    {
        name: `status`,
        description: `状态`,
        data_type: DataType.Int8,
    },
    {
        name: `text`,
        description: `分句原文（BM25 词面检索用，jieba 中文分词）`,
        data_type: DataType.VarChar,
        max_length: 65535,
        enable_analyzer: true,
        analyzer_params: {tokenizer: 'jieba'},
    },
    {
        name: `content`,
        description: `分句文本向量（dense，bge-m3）`,
        data_type: DataType.FloatVector,
        dim: dim,
    },
    {
        name: `sparse`,
        description: `分句 BM25 稀疏向量（function 自动生成，勿手工写）`,
        data_type: DataType.SparseFloatVector,
    },
]

/** BM25 function：text → sparse，服务端分词打分，入库时无需传 sparse */
const functions = [
    {
        name: `bm25`,
        type: FunctionType.BM25,
        input_field_names: ['text'],
        output_field_names: ['sparse'],
    },
]

const index = [
    {
        collection_name,
        field_name: 'content',
        index_name: 'i_content',
        index_type: IndexType.HNSW,
        params: {efConstruction: 100, M: 64},
        metric_type: 'L2',
    },
    {
        collection_name,
        field_name: 'sparse',
        index_name: 'i_sparse',
        index_type: IndexType.SPARSE_INVERTED_INDEX,
        metric_type: MetricType.BM25,
        params: {},
    },
]

export default {
    collection_name,
    schema,
    functions,
    index
}
