/**
 * @fileOverview 操作mongodb库中的region
 * @author xianyang
 * @module
 */

import {Region} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class RegionDac extends BaseDac {
    constructor(Model) {
        super(Model, 'regionCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.parentCode) {
            params.$and.push({parentCode: {$eq: options.parentCode}})
        }
        if (tools.isArray(options.path)) {
            params.$and.push({path: {$in: options.path}})
        } else if (options.path) {
            params.$and.push({path: options.path})
        }
        if (!tools.isUndefined(options.levelNum)) {
            params.$and.push({levelNum: options.levelNum})
        }
        if (tools.isExist(options.regionName)) {
            params.$and.push({regionName: {$regex: new RegExpExt(options.regionName, 'i', true)}})
        }
        if (tools.isExist(options.fullName)) {
            params.$and.push({fullName: {$regex: new RegExpExt(options.fullName, 'i', true)}})
        }
        return params
    }
}

export default new RegionDac(Region)