export const listSource = {
    includes: ['key_*', 'long_*'],
    excludes: ['s_string_*', 'nested_*', 'embedding_*']
}

export const detailSource = {
    includes: ['key_*', 'long_*', 'nested_*'],
    excludes: ['text_cn_*', 's_string_*', 'embedding_*']
}

export const defaultSearchFields = ['text_cn_smart_title^24', 'text_cn_title^12']

export const searchFieldMapping = {
    title: {
        match: ['text_cn_smart_title^2', 'text_cn_title'],
        term: ['key_title'],
        knn: ['embedding_content']
    },
}

export const defaultFilters = {
    not: {status: -1},
}

export const filterFieldMapping = {
    status: {
        field: 'long_status'
    }
}

export const sortFieldMapping = {
    insertTime: {
        field: 'date_insertTime'
    },
    updateTime: {
        field: 'date_updateTime'
    }
}

export const aggMapping = {
    indexType: {
        'terms': {'field': 'long_indexType', size: 50, shard_size: 85}
    }
}