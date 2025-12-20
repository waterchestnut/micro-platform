/**
 * @fileOverview 操作mongodb库中的orgInfo
 * @author xianyang
 * @module
 */

import {OrgInfo} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class OrgInfoDac extends BaseDac {
    constructor(Model) {
        super(Model, 'orgCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.orgCode)) {
            params.$and.push({orgCode: {$in: options.orgCode}})
        } else if (options.orgCode) {
            params.$and.push({orgCode: options.orgCode})
        }
        if (tools.isExist(options.orgName)) {
            params.$and.push({orgName: {$regex: new RegExpExt(options.orgName, 'i', true)}})
        }
        if (tools.isExist(options.orgNameEn)) {
            params.$and.push({orgNameEn: {$regex: new RegExpExt(options.orgNameEn, 'i', true)}})
        }
        return params
    }

    /**
     * @description 根据机构名称查询机构记录
     * @author xianyang
     * @param {String} orgName 机构名称
     * @param {Object | String | Array[String]} [projection] 返回字段（默认返回全部）
     * @param {Object} [options] 其他参数，详情请查看：https://mongoosejs.com/docs/api/query.html#query_Query-setOptions
     * @returns {Promise<Object>} 记录对象
     */
    async getByOrgName(orgName, projection = null, options = null) {
        let doc = await OrgInfo.findOne({orgName}, projection, options).lean().exec()
        return doc
    }
}

export default new OrgInfoDac(OrgInfo)