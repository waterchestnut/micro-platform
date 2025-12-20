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
    commonMatch: {
        match: ['text_cn_smart_title^4', 'text_cn_title', 'text_cn_smart_content_msg^3',]
    },
    msgCode: {
        term: ['key_msgCode']
    },
    operateType: {
        term: ['key_operateType']
    },
    clientCode: {
        term: ['key_clientCode']
    },
    clientName: {
        term: ['key_clientName']
    },
    sysCode: {
        term: ['key_sysCode']
    },
    sysName: {
        term: ['key_sysName']
    },
    userCode: {
        term: ['key_userCode']
    },
    realName: {
        term: ['key_realName']
    },
    browseTime: {
        range: ['date_browseTime']
    },
}

export const defaultFilters = {
    not: {status: -1},
}

export const filterFieldMapping = {
    status: {
        field: 'long_status'
    },
    operateType: {
        field: 'key_operateType'
    },
    clientCode: {
        field: 'key_clientCode'
    },
    sysCode: {
        field: 'key_sysCode'
    },
}

export const sortFieldMapping = {
    browseTime: {
        field: 'date_browseTime'
    },
}

export const aggMapping = {
    operateType: {
        'terms': {'field': 'key_operateType', size: 200, shard_size: 350}
    }
}