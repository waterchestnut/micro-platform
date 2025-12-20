/**
 * @fileOverview 操作mongodb库中的ragMaterial
 * @author xianyang
 * @module
 */

import {RagMaterial} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class RagMaterialDac extends BaseDac {
    constructor(Model) {
        super(Model, 'ragMaterialCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.ragMaterialCode)) {
            params.$and.push({ragMaterialCode: {$in: options.ragMaterialCode}})
        } else if (options.ragMaterialCode) {
            params.$and.push({ragMaterialCode: {$eq: options.ragMaterialCode}})
        }
        if (options.ragType) {
            params.$and.push({ragType: {$eq: options.ragType}})
        }
        if (tools.isArray(options.ragCode)) {
            params.$and.push({ragCode: {$in: options.ragCode}})
        } else if (options.ragCode) {
            params.$and.push({ragCode: {$eq: options.ragCode}})
        }
        if (options.format) {
            params.$and.push({format: {$eq: options.format}})
        }
        if (tools.isExist(options.physicalPath)) {
            params.$and.push({physicalPath: {$regex: new RegExpExt(options.physicalPath, 'i', true)}})
        }
        if (tools.isExist(options.resTitle)) {
            params.$and.push({resTitle: {$regex: new RegExpExt(options.resTitle, 'i', true)}})
        }
        if (tools.isArray(options.usage)) {
            params.$and.push({usage: {$in: options.usage}})
        } else if (!tools.isUndefined(options.usage)) {
            params.$and.push({usage: {$eq: options.usage}})
        }
        if (tools.isArray(options.resCode)) {
            params.$and.push({resCode: {$in: options.resCode}})
        } else if (options.resCode) {
            params.$and.push({resCode: {$eq: options.resCode}})
        }
        if (tools.isArray(options.fileHashCode)) {
            params.$and.push({'fileList.fileHashCode': {$in: options.fileHashCode}})
        } else if (options.fileHashCode) {
            params.$and.push({'fileList.fileHashCode': {$eq: options.fileHashCode}})
        }
        return params
    }
}

export default new RagMaterialDac(RagMaterial)