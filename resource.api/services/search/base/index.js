import {Client as Client8} from 'es8'
import * as util from './util.js'
import * as mapping from './mapping.js'

const searchConfig = resource.config.searchConfig
const logger = resource.logger

class Search {
    _configKey = ''
    _esConfig

    constructor(configKey) {
        this._configKey = configKey
        if (!searchConfig[this._configKey]) {
            throw new Error('索引库配置不存在')
        }
        this._esConfig = searchConfig[this._configKey]
        this._client8 = new Client8({
            nodes: this._esConfig.baseUrl.split(','),
            compression: true,
            auth: this._esConfig.auth,
            requestTimeout: 120000
        })
    }

    getMapping() {
        return mapping
    }

    getIndexUrl() {
        return this._esConfig.baseUrl.split(',')[0] + '/' + this._esConfig.index
    }

    getDetailUrl(id) {
        return this.getIndexUrl() + '/' + id
    }

    getSearchUrl() {
        return this.getIndexUrl() + '/_search'
    }

    getAggUrl() {
        return this.getIndexUrl() + '/_search'
    }

    getAnalyzeUrl() {
        return this.getIndexUrl() + '/_analyze'
    }

    formatField(retItem, item, key) {
        return null
    }

    formatItem(retItem, item, textMaxWords) {
        return null
    }

    formatBucketItem(retItem, item, retKey, ret) {
        return null
    }

    /**
     * 读取单条数据详情
     */
    async getDetail(id) {
        const {detailSource, listSource} = this.getMapping()
        try {
            const result = await this._client8.get({
                index: this._esConfig.index,
                id: id,
                _source_includes: detailSource.includes.join(','),
                _source_excludes: detailSource.excludes.join(',')
            })
            // console.log(result);
            let detail = result?._source ? util.formatDataList([result], {
                formatField: this.formatField,
                formatItem: this.formatItem
            })[0] : undefined
            // console.log(detail);
            return detail
        } catch (e) {
            console.error(e)
            return null
        }
    }

    /**
     * search.search([{query:[{q:''}]}])
     */
    async search(paramList, sort, pageIndex, pageSize, options = {}) {
        paramList = paramList || [{query: [{q: ''}]}]
        const mapping = this.getMapping()
        const {detailSource, listSource, sortFieldMapping} = mapping
        let params = {
            _source: options.sourceList ? options.sourceList : (options.source && mapping[options.source] ? mapping[options.source] : listSource),
            query: options.isOriginalQuery ? paramList : {bool: {must: util.buildQuery(paramList, false, null, mapping)}}
        }
        if (!options.hiddeHighlight) {
            params.highlight = {
                fields: {
                    _all: {},
                    'text_cn_*': {number_of_fragments: 2, fragment_size: 50}
                }
            }
        }
        if (sort) {
            let sortES = sort.filter(item => sortFieldMapping[item[0]] && sortFieldMapping[item[0]].field).map(item => ({[sortFieldMapping[item[0]].field]: {order: item[1] ? item[1] : 'asc'}}))
            params.sort = sortES
            params.sort.push('_score')
        }

        let from
        let page = 10
        if (parseInt(pageSize) > 0) {
            page = parseInt(pageSize)
        }
        params.size = page
        let pageNum = parseInt(pageIndex)
        if (pageNum > -1) {
            pageNum = pageNum - 1
            if (pageNum < 0) {
                pageNum = 0
            }
            from = pageNum * page
            params.from = from
        }

        if (options.minScore) {
            params.min_score = options.minScore
        }
        //console.log(JSON.stringify(params));
        const result = await this._client8.search({
            index: this._esConfig.index,
            body: params
        })
        //console.log(result);
        let complete = options.text === 'complete'
        //console.log(complete);
        let ret = {
            total: result.hits.total?.value || 0,
            rows: util.formatDataList(result.hits.hits, {
                complete, formatField: this.formatField,
                formatItem: this.formatItem
            })
        }
        return ret
    }

    /**
     * eg：search.agg([{query:[{q:''}]}])
     */
    async agg(paramList = [{query: [{q: ''}]}], options = {}, filter = {}, aggParams = {}) {
        const mapping = this.getMapping()
        let params = {
            query: options.isOriginalQuery ? paramList : {bool: {must: util.buildQuery(paramList, true, filter, mapping)}},
            aggs: util.buildAggs(aggParams, mapping),
            size: 0
        }
        if (options.minScore) {
            params.min_score = options.minScore
        }

        //console.log(JSON.stringify(params));
        const result = await this._client8.search({
            index: this._esConfig.index,
            body: params
        })
        // console.log(JSON.stringify(result));
        let ret = util.formatAgg(result, {formatBucketItem: this.formatBucketItem})
        //console.log(ret);
        return ret
    }

    async analyze(q, options = {}) {
        if (!q) {
            throw new Error('检索词不能为空')
        }

        let params = {
            analyzer: 'ik_max_word',
            text: q
        }
        if (options.analyzer) {
            params.analyzer = options.analyzer
        }

        try {
            const result = await this._client8.indices.analyze({
                index: this._esConfig.index,
                body: params
            })
            //console.log(result);
            return result.tokens
        } catch (e) {
            console.error(e)
            return null
        }
    }

    async updateDocs(jsonDocs) {
        let ret = await this._client8.bulk({
            index: this._esConfig.index,
            body: jsonDocs
        }, {
            ignore: [404],
            maxRetries: 10
        })
        if (ret?.errors) {
            logger.error(JSON.stringify(ret))
        }

        return ret
    }

    async deleteById(id) {
        let ret = await this._client8.delete({
            index: this._esConfig.index,
            id: id
        }, {
            ignore: [404],
            maxRetries: 10
        })

        return ret
    }

    async deleteByQuery(query) {
        let ret = await this._client8.deleteByQuery({
            index: this._esConfig.index,
            body: {
                query
            }
        }, {
            ignore: [404, 400, 409],
            maxRetries: 10
        })

        return ret
    }

    getUpdateJson(obj) {
        return '{"update":{"_id":"' + obj['ukey'] + '"}}\n{"doc":' + JSON.stringify(obj) + ',"doc_as_upsert":true}\n'
    }

    getDeleteJson(id) {
        return '{"delete":{"_id":"' + id + '"}}\n'
    }

    /**
     * 更新索引
     */
    async updateIndex(dataList) {
        return {code: 0}
    }
}

export default Search