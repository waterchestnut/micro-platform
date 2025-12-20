/**
 * @fileOverview resource检索
 * @module
 */

import BaseSearch from '../base/index.js'
import * as mapping from './mapping.js'
import dayjs from 'dayjs'

const tools = resource.tools

export class ResourceSearch extends BaseSearch {
    constructor() {
        super('resource')
    }

    getMapping() {
        return mapping
    }

    formatItem(retItem, item, textMaxWords) {
        return null
    }

    async updateIndex(dataList) {
        if (!dataList?.length) {
            return {code: -1, msg: '没有要更新的信息'}
        }
        let jsonDocs = ''
        for (let i = 0; i < dataList.length; i++) {
            let item = dataList[i]
            let doc = await this.getDoc(item)
            jsonDocs += this.getUpdateJson(doc)
        }
        if (jsonDocs) {
            await this.updateDocs(jsonDocs)
        }
        return {code: 0}
    }

    async getDetail(resCode) {
        return super.getDetail(this._configKey + '_' + resCode)
    }

    async getDoc(resInfo) {
        let doc = {
            ukey: this._configKey + '_' + resInfo.resCode,
            key_resCode: resInfo.resCode,
            key_publisher: resInfo.publisher,
            key_author: resInfo.author,
            key_resType: resInfo.resType,
            date_publishDate: resInfo.publishDate ? dayjs(resInfo.publishDate).format('YYYY-MM-DD') : null,
            key_publishDateStr: resInfo.publishDateStr,
            key_coverUrl: resInfo.coverUrl,
            key_url: resInfo.url,
            key_keywords: resInfo.keywords,
            key_category: resInfo.category,
            key_language: resInfo.language,
            key_issues: resInfo.issues ?? null,
            key_journalTitle: resInfo.journalTitle ?? null,
            long_status: resInfo.status,
            text_cn_abstract: resInfo.abstract,
            text_cn_smart_abstract: resInfo.abstract,
            key_title: resInfo.title,
            text_cn_title: resInfo.title,
            text_cn_smart_title: resInfo.title,
        }
        if (resInfo.sources?.length) {
            let sources = []
            let sourceKeys = []
            resInfo.sources.forEach(_ => {
                sources.push({
                    sourceKey: _.sourceKey,
                    href: _.href,
                    title: _.title,
                    description: _.description
                })
                sourceKeys.push(_.sourceKey)
            })
            doc.nested_sources = sources
            doc.key_source_keys = sourceKeys
        } else {
            doc.nested_sources = null
            doc.key_source_keys = null
        }
        return doc
    }
}

export default new ResourceSearch()