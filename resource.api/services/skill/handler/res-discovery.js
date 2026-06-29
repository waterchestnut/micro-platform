/**
 * @fileOverview 资源发现相关技能的命令
 * @author xianyang
 * @module
 */

import BaseHandler from './base.js'
import resourceSearch from '../../search/resource/index.js'

const tools = resource.tools
const logger = resource.logger
const config = resource.config

class ResDiscovery extends BaseHandler {
    constructor() {
        super()
    }

    /**
     * 检索并返回资源的元数据信息
     * @param {Object} params - 检索参数
     * @param {string} params.keywords - 检索关键词，不能为空
     * @param {string} [params.resType] - 资源类型筛选条件（可选）
     * @param {number} [params.maxCount] - 最大返回条数，默认10
     * @param {Object} curUserInfo - 当前用户信息
     * @returns {Promise<Array>} 资源元数据列表，包含resCode、abstract、category、status、title、resType、publishDateStr、keywords、language、journalTitle、issue、publisher、author等字段
     * @throws {Error} 检索关键词为空时抛出异常
     */
    async searchResMetas(params, curUserInfo) {
        if (!params.keywords || params.keywords.length < 1) {
            throw new Error('检索关键词不能为空')
        }
        let maxCount = params.maxCount || 10
        let filter = {}
        if (params.resType) {
            filter.resType = params.resType
        }
        let ret = await resourceSearch.search([{
            query: [{q: params.keywords, key: 'commonMatch', method: 'match'}],
            filter
        }], [], 1, maxCount, {hiddeHighlight: true})
        return ret?.rows?.map(item => ({
            resCode: item.resCode,
            abstract: item.abstract,
            category: item.category,
            status: item.status || 0,
            title: item.title,
            resType: item.resType,
            publishDateStr: item.publishDateStr,
            keywords: item.keywords,
            language: item.language,
            journalTitle: item.journalTitle,
            issue: item.issue,
            publisher: item.publisher,
            author: item.author
        })) || []
    }
}

export default ResDiscovery
