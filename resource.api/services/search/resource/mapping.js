export const listSource = {
    includes: ['text_cn_*', 'key_*', 'long_*', 'date_*', 'double_*', 'nested_*'],
    excludes: ['s_string_*', 'embedding_*']
}

export const detailSource = {
    includes: ['text_cn_*', 'key_*', 'long_*', 'date_*', 'double_*', 'nested_*'],
    excludes: ['s_string_*', 'embedding_*']
}

export const defaultSearchFields = ['text_cn_smart_title^24', 'text_cn_title^12']

export const searchFieldMapping = {
    title: {
        match: ['text_cn_smart_title^2', 'text_cn_title'],
        term: ['key_title']
    },
    publisher: {
        match: ['text_cn_smart_publisher^2', 'text_cn_publisher'],
        term: ['key_publisher']
    },
    author: {
        match: ['text_cn_smart_author^2', 'text_cn_author'],
        term: ['key_author']
    },
    commonMatch: {
        match: ['text_cn_smart_title^4', 'text_cn_title', 'text_cn_smart_author^3', 'text_cn_author', 'text_cn_smart_publisher^2', 'text_cn_publisher', 'text_cn_smart_abstract', 'text_cn_abstract']
    },

    resType: {
        term: ['key_resType']
    },

    publishDate: {
        range: ['date_publishDate']
    }
}

export const defaultFilters = {
    not: {status: -1},
}

export const filterFieldMapping = {
    status: {
        field: 'long_status'
    },
    type: {
        field: 'key_resType'
    },
    resType: {
        field: 'key_resType'
    },
    publishDate: {
        field: 'date_publishDate'
    },
}

export const sortFieldMapping = {}

export const aggMapping = {
    resType: {
        'terms': {'field': 'key_resType', size: 200, shard_size: 350}
    }
}