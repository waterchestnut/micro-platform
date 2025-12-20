const {isArray, isFunction} = resource.tools
const tools = resource.tools

const unionKeys = ['should', 'must', 'must_not']
const unionMaps = {or: 'should', and: 'must', not: 'must_not'}

/**
 * 格式化检索结果
 */
export function formatDataList(dataList, options = {
    formatField: undefined,
    formatItem: undefined
}) {
    if (!dataList || !dataList.length) {
        return []
    }
    options.textMaxWords = options.textMaxWords || 500
    return dataList.map(item => {
        let retItem = {}
        let textMaxWords = options.textMaxWords
        for (let key in item._source) {
            retItem[key.replace(/^(long_)|(key_)|(string_)|(nested_)|(ip_)|(object_)|(double_)|(date_)|(text_cn_smart_)|(text_cn_)|(embedding_)/i, '')] = item._source[key]
            options.formatField && options.formatField(retItem, item, key)
        }
        if (item.highlight) {
            let highLight = {}
            for (let key in item.highlight) {
                if (key.match(/text_cn_smart_|embedding_/)) {
                    // 跳过smart、embedding标红
                    continue
                }
                let itemKey = key.replace(/^(long_)|(key_)|(string_)|(nested_)|(ip_)|(object_)|(double_)|(date_)|(text_cn_smart_)|(text_cn_)|(embedding_)/i, '')
                let hlItem = {keys: {}, hlWords: 0, hlUniqueWords: 0}

                let text = item.highlight[key].join('...')
                hlItem.keys[itemKey] = text
                let wordMatches = text.matchAll(/<em>([^<>]+)<\/em>/ig)
                let words = {}
                for (let wordMatch of wordMatches) {
                    hlItem.hlWords += wordMatch[1].length
                    if (!words[wordMatch[1]]) {
                        words[wordMatch[1]] = 1
                        hlItem.hlUniqueWords += wordMatch[1].length
                    }
                }

                highLight[itemKey] = highLight[itemKey] || []
                highLight[itemKey].push(hlItem)
            }
            for (let itemKey in highLight) {
                highLight[itemKey].sort((a, b) => {
                    return b.hlUniqueWords === a.hlUniqueWords ? (b.hlWords - a.hlWords) : (b.hlUniqueWords - a.hlUniqueWords)
                })
                Object.assign(retItem, highLight[itemKey][0].keys)
                retItem[itemKey] = ''
                highLight[itemKey].forEach(hlpage => {
                    let mainVal = hlpage.keys[itemKey]
                    if (retItem[itemKey].length < options.textMaxWords) {
                        retItem[itemKey] = retItem[itemKey] + (retItem[itemKey] ? '...' : '') + mainVal
                    }
                })

                if (retItem[itemKey].length > options.textMaxWords) {
                    textMaxWords = retItem[itemKey].length
                }
            }
        }
        options.formatItem && options.formatItem(retItem, item, textMaxWords)
        return retItem
    })
}

/**
 * 格式化分面结果
 */
export function formatAgg(result, options = {
    formatBucketItem: undefined
}) {
    const aggregations = result.aggregations
    let ret = {total: result.hits?.total?.value || 0}
    for (let key in aggregations) {
        if (!aggregations[key].buckets) {
            ret[key] = aggregations[key]
            continue
        }
        ret[key] = []
        aggregations[key].buckets.forEach((item) => {
            let retItem = {
                name: item.key,
                count: item.doc_count,
                ...item
            }
            options.formatBucketItem && options.formatBucketItem(retItem, item, key, ret)
            tools.isExist(retItem.name) && ret[key].push(retItem)
        })
    }
    return ret
}

/**
 * 格式化ES检索参数
 * @param {Array} params 检索条件列表：['not',{q:'0',key:'0',method:'match'},'and',{q:'1',key:'1',method:'term'},'not',{q:'2',key:'2',method:'match'},'or',{q:'3',key:'3',method:'match'},'and',{q:'4',key:'4',method:'match'}]
 */
export function queryFormat(params) {
    let paramsLAnd = []
    for (let iNot = 0; iNot < params.length; iNot++) {
        if ((params[iNot] === 'not')) {
            if (iNot > 0 && typeof params[iNot - 1] === 'object') {
                paramsLAnd.push('and')
            }
            paramsLAnd.push({op: 'not', item: params[iNot + 1]})
            iNot++
        } else if (iNot > 0 || typeof params[iNot] === 'object') {
            paramsLAnd.push(params[iNot])
        }
    }

    let paramsLOr = []
    let itemLAnd = null
    for (let iAnd = 0; iAnd < paramsLAnd.length; iAnd++) {
        if (paramsLAnd[iAnd] === 'and') {
            itemLAnd = itemLAnd || {op: 'and', items: []}
            itemLAnd.items.push(paramsLAnd[iAnd - 1])
        } else if (paramsLAnd[iAnd] === 'or') {
            itemLAnd = itemLAnd || {op: 'and', items: []}
            itemLAnd.items.push(paramsLAnd[iAnd - 1])
            paramsLOr.push(itemLAnd)
            itemLAnd = null
        } else if (iAnd === paramsLAnd.length - 1) {
            itemLAnd = itemLAnd || {op: 'and', items: []}
            itemLAnd.items.push(paramsLAnd[iAnd])
            paramsLOr.push(itemLAnd)
        }
    }

    return paramsLOr
}

/**
 * 构建ES检索条件
 * @param {Array} params 检索条件列表：[{query:['not',{q:'0',key:'0',method:'match'},'and',{q:'1',key:'1',method:'term'},'not',{q:'2',key:'2',method:'match'},'or',{q:['3','56'],key:'3',method:'match'},'and',{q:{gte:1,lte:3},key:'4',method:'range'}],filter:{}}]
 * @param {Boolean} isAgg 是否构建分面，构建分面时排除filter
 * @param {Object} aggFilter 分面特有的过滤条件
 * @param {Object} mapping 检索相关的字段映射
 */
export function buildQuery(params, isAgg = false, aggFilter = {}, mapping) {
    const {searchFieldMapping, defaultSearchFields, filterFieldMapping, defaultFilters} = mapping
    params[0].filter = Object.assign({}, defaultFilters, isAgg ? aggFilter : params[0].filter)
    let musts = []
    let index = 0
    params.forEach(item => {
        let orQuery = {bool: {must: {bool: {should: []}}}}
        let orList = queryFormat(item.query)
        //console.log(orList);
        orList.forEach(orItem => {
            let andList = orItem.items
            let andQuery = {bool: {must: []}}
            andList.forEach((andItem) => {
                let entity = andItem
                if (andItem.op === 'not') {
                    entity = andItem.item
                }
                let match = buildItemMatch(entity, mapping)
                if (andItem.op === 'not' && match) {
                    andQuery.bool.must.push({
                        bool: {must_not: match}
                    })
                } else if (match) {
                    andQuery.bool.must.push(match)
                }
            })
            orQuery.bool.must.bool.should.push(andQuery)
        })

        if (item.filter && (!isAgg || !index)) {
            orQuery.bool.filter = []
            buildFilters(orQuery.bool.filter, item.filter, mapping)
        }
        musts.push(orQuery)
        index++
    })
    return musts
}

/**
 * 构建单项匹配参数
 */
function buildItemMatch(entity, mapping) {
    const {searchFieldMapping, defaultSearchFields, filterFieldMapping, defaultFilters} = mapping

    let match = {match_all: {}}

    if (!tools.isUndefined(entity.q) && entity.method === 'match') {
        return {
            multi_match: {
                query: entity.q,
                fields: searchFieldMapping[entity.key] && searchFieldMapping[entity.key].match ? searchFieldMapping[entity.key].match : defaultSearchFields,
                operator: 'and',
                type: 'cross_fields'
            }
        }
    }

    if (!tools.isUndefined(entity.q) && entity.method === 'term' && searchFieldMapping[entity.key] && searchFieldMapping[entity.key].term) {
        let termKey = 'term'
        if (isArray(entity.q)) {
            termKey = 'terms'
        }
        if (searchFieldMapping[entity.key].term.length > 1) {
            match = {bool: {should: []}}
            searchFieldMapping[entity.key].term.forEach((termField) => {
                if (termField.includes('.')) {
                    match.bool.should.push({
                        nested: {
                            path: termField.split('.')[0],
                            query: {
                                bool: {
                                    must: {[termKey]: {[termField]: entity.q}}
                                }
                            }
                        }
                    })
                } else {
                    match.bool.should.push({[termKey]: {[termField]: entity.q}})
                }
            })
        } else {
            let termField = searchFieldMapping[entity.key].term[0]
            if (termField.includes('.')) {
                match = {
                    nested: {
                        path: termField.split('.')[0],
                        query: {
                            bool: {
                                must: {[termKey]: {[termField]: entity.q}}
                            }
                        }
                    }
                }
            } else {
                match = {[termKey]: {[termField]: entity.q}}
            }
        }
        return match
    }

    if (!tools.isUndefined(entity.q) && entity.method === 'range' && searchFieldMapping[entity.key] && searchFieldMapping[entity.key].range) {
        if (searchFieldMapping[entity.key].range.length > 1) {
            match = {bool: {should: []}}
            searchFieldMapping[entity.key].range.forEach((rangeField) => {
                if (rangeField.includes('.')) {
                    match.bool.should.push({
                        nested: {
                            path: rangeField.split('.')[0],
                            query: {
                                bool: {
                                    must: {'range': {[rangeField]: entity.q}}
                                }
                            }
                        }
                    })
                } else {
                    match.bool.should.push({'range': {[rangeField]: entity.q}})
                }
            })
        } else {
            let rangeField = searchFieldMapping[entity.key].range[0]
            if (rangeField.includes('.')) {
                match = {
                    nested: {
                        path: rangeField.split('.')[0],
                        query: {
                            bool: {
                                must: {'range': {[rangeField]: entity.q}}
                            }
                        }
                    }
                }
            } else {
                match = {'range': {[rangeField]: entity.q}}
            }
        }
        return match
    }

    if (!tools.isUndefined(entity.q) && entity.method === 'regexp' && searchFieldMapping[entity.key] && searchFieldMapping[entity.key].regexp) {
        if (searchFieldMapping[entity.key].regexp.length > 1) {
            match = {bool: {should: []}}
            searchFieldMapping[entity.key].regexp.forEach((regexpField) => {
                if (regexpField.includes('.')) {
                    match.bool.should.push({
                        nested: {
                            path: regexpField.split('.')[0],
                            query: {
                                bool: {
                                    must: {'regexp': {[regexpField]: entity.q}}
                                }
                            }
                        }
                    })
                } else {
                    match.bool.should.push({'regexp': {[regexpField]: entity.q}})
                }
            })
        } else {
            let regexpField = searchFieldMapping[entity.key].regexp[0]
            if (regexpField.includes('.')) {
                match = {
                    nested: {
                        path: regexpField.split('.')[0],
                        query: {
                            bool: {
                                must: {'regexp': {[regexpField]: entity.q}}
                            }
                        }
                    }
                }
            } else {
                match = {'regexp': {[regexpField]: entity.q}}
            }
        }
        return match
    }

    if (!tools.isUndefined(entity.q) && entity.method === 'knn' && searchFieldMapping[entity.key] && searchFieldMapping[entity.key].knn) {
        if (searchFieldMapping[entity.key].knn.length > 1) {
            match = {bool: {should: []}}
            searchFieldMapping[entity.key].knn.forEach((rangeField) => {
                if (rangeField.includes('.')) {
                    match.bool.should.push({
                        nested: {
                            path: rangeField.split('.')[0],
                            query: {
                                knn: {
                                    ...entity.knnOptions,
                                    query_vector: entity.q,
                                    field: rangeField,
                                }
                            }
                        }
                    })
                } else {
                    match.bool.should.push({
                        knn: {
                            ...entity.knnOptions,
                            query_vector: entity.q,
                            field: rangeField,
                        }
                    })
                }
            })
        } else {
            let rangeField = searchFieldMapping[entity.key].knn[0]
            if (rangeField.includes('.')) {
                match = {
                    nested: {
                        path: rangeField.split('.')[0],
                        query: {
                            knn: {
                                ...entity.knnOptions,
                                query_vector: entity.q,
                                field: rangeField,
                            }
                        }
                    }
                }
            } else {
                match = {
                    knn: {
                        ...entity.knnOptions,
                        query_vector: entity.q,
                        field: rangeField,
                    }
                }
            }
        }
        return match
    }

    if (!tools.isUndefined(entity.q) && entity.method === 'custom' && searchFieldMapping[entity.key] && isFunction(searchFieldMapping[entity.key].custom)) {
        match = searchFieldMapping[entity.key].custom(entity.q)
        return match
    }

    return match
}

/**
 * 构建过滤参数
 */
function buildFilters(filters = [], params, mapping) {
    const {searchFieldMapping, defaultSearchFields, filterFieldMapping, defaultFilters} = mapping
    //console.log(filters,params);
    for (let key in params) {
        if (typeof params[key] === 'undefined') {
            continue
        }
        if (unionKeys.includes(key) || ({}).hasOwnProperty.call(unionMaps, key)) {
            let children = []
            let mapKey = unionKeys.includes(key) ? key : unionMaps[key]
            filters.push({bool: {[mapKey]: children}})

            if (isArray(params[key])) {
                params[key].forEach((item) => {
                    let innerChildren = []
                    children.push({bool: {must: innerChildren}})
                    buildFilters(innerChildren, item, mapping)
                })
            } else {
                buildFilters(children, params[key], mapping)
            }
            continue
        }
        let mapKey = filterFieldMapping[key] ? filterFieldMapping[key].field : ''
        if (!mapKey) {
            continue
        }
        let filter = {}
        if (isArray(params[key])) {
            filter = {terms: {[mapKey]: params[key]}}
        } else if (params[key]._range) {
            filter = {range: {[mapKey]: params[key]._range}}
        } else if (params[key]._regexp) {
            filter = {regexp: {[mapKey]: params[key]._regexp}}
        } else if (params[key]._exists) {
            filter = {exists: {field: mapKey}}
        } else {
            filter = {term: {[mapKey]: params[key]}}
        }
        if (mapKey.includes('.')) {
            filters.push({
                nested: {
                    path: mapKey.split('.')[0],
                    query: {
                        bool: {
                            filter: [filter]
                        }
                    }
                }
            })
        } else {
            filters.push(filter)
        }
    }
    return filters
}

/**
 * 构建聚合的参数
 */
export function buildAggs(params = {}, mapping) {
    const {aggMapping} = mapping
    /*console.log(params, aggMapping);*/
    let result = {}
    for (let key in params) {
        if (key === '$complex') {
            result = {...result, ...params[key]}
            continue
        }
        if (!aggMapping[key]) {
            continue
        }
        result[key] = tools.cloneDeep(aggMapping[key])
    }
    return result
}