/**
 * @fileOverview 操作mongodb库中的fav
 * @module
 */

import {Fav} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class FavDac extends BaseDac {
    constructor(Model) {
        super(Model, 'favCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.resCode)) {
            params.$and.push({resCode: {$in: options.resCode}})
        } else if (options.resCode) {
            params.$and.push({resCode: {$eq: options.resCode}})
        }
        if (tools.isArray(options.userCode)) {
            params.$and.push({userCode: {$in: options.userCode}})
        } else if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (tools.isExist(options.sourcePlatform)) {
            params.$and.push({sourcePlatform: {$eq: options.sourcePlatform}})
        }
        if (tools.isArray(options.resType)) {
            params.$and.push({resType: {$in: options.resType}})
        } else if (options.resType) {
            params.$and.push({resType: {$eq: options.resType}})
        }
        return params
    }

    async getFavsByUser(userCode, pageIndex = 1, pageSize = 10, options = {}) {
        options.userCode = userCode
        return this.getByPage(pageIndex, pageSize, options)
    }
}

export default new FavDac(Fav)