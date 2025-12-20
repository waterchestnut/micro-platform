/**
 * @fileOverview 知识库材料分句的向量存储结构
 * @author xianyang 2025/6/27
 * @module
 */
import {DataType, IndexType} from '@zilliz/milvus2-sdk-node'

const collection_name = `chunk`
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
        name: `content`,
        description: `分句文本向量`,
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
        params: {efConstruction: 100, M: 64},
        metric_type: 'L2',
    }
]

export default {
    collection_name,
    schema,
    index
}