/**
 * @fileOverview 操作mongodb库中的resInfo
 * @module
 */

import {ResInfo} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class ResInfoDac extends BaseDac {
    constructor(Model) {
        super(Model, 'resCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.resCode)) {
            params.$and.push({resCode: {$in: options.resCode}})
        } else if (options.resCode) {
            params.$and.push({resCode: {$eq: options.resCode}})
        }
        if (options.resType) {
            params.$and.push({resType: {$eq: options.resType}})
        }
        if (options.operatorUserCode) {
            params.$and.push({'operator.userCode': {$eq: options.operatorUserCode}})
        }
        if (tools.isArray(options.originalResCode)) {
            params.$and.push({originalResCode: {$in: options.originalResCode}})
        } else if (options.originalResCode) {
            params.$and.push({originalResCode: {$eq: options.originalResCode}})
        }
        if (tools.isArray(options.manageType)) {
            params.$and.push({manageTypes: {$in: options.manageType}})
        } else if (options.manageType) {
            params.$and.push({manageTypes: options.manageType})
        }
        if (tools.isExist(options.title)) {
            params.$and.push({title: {$regex: new RegExpExt(options.title, 'i', true)}})
        }
        if (tools.isExist(options.publisher)) {
            params.$and.push({publisher: {$regex: new RegExpExt(options.publisher, 'i', true)}})
        }
        if (tools.isArray(options.originalHashCode)) {
            params.$and.push({originalHashCode: {$in: options.originalHashCode}})
        } else if (!tools.isUndefined(options.originalHashCode)) {
            params.$and.push({originalHashCode: {$eq: options.originalHashCode}})
        }
        if (tools.isExist(options.keyword)) {
            let keywordReg = {$regex: new RegExpExt(options.keyword, 'i', true)};
            params.$and.push({
                $or: [
                    {title: keywordReg},
                    {author: keywordReg},
                    {abstract: keywordReg},
                    {keywords: keywordReg}
                ]
            })
        }
        return params
    }

}

export default new ResInfoDac(ResInfo)