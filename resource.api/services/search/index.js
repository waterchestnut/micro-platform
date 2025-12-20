/**
 * @fileOverview 通用、混合检索等
 * @author xianyang 2025/8/23
 * @module
 */

import resourceSearch from './resource/index.js'

/*多源混合检索*/
export async function mergeSearch(query, filter = {}, pageIndex = 1, pageSize = 10, options = {}, sort = []) {
    return await resourceSearch.search(esAssembleParams({commonMatch: query.keyword}, {type: filter.type,publishDate: filter.publishDate}), [], pageIndex, pageSize, {
        hiddeHighlight: true
    })
}

/*ES检索的参数拼接*/
function esAssembleParams(queryParams, filterParams) {
    let query = []
    const pushQuery = (item) => {
        if (query.length) {
            query.push('and')
        }
        query.push(item)
    }

    if (queryParams.commonMatch) {
        pushQuery({q: queryParams.commonMatch, key: 'commonMatch', method: 'match'})
    }
    if (typeof queryParams.resType != 'undefined') {
        pushQuery({
            q: queryParams.resType,
            key: 'resType',
            method: 'term'
        })
    }
    if (Array.isArray(queryParams.publishDate)) {
        pushQuery({
            q: {gte: queryParams.publishDate[0], lte: queryParams.publishDate[1]},
            key: 'publishDate',
            method: 'range'
        })
    }

    if (!query.length) {
        pushQuery({q: ''})
    }

    return [{query, filter: filterParams || {}}]
}
