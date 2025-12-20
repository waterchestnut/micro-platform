/**
 * @fileOverview 操作mongodb库中的ragSegment
 * @author xianyang
 * @module
 */

import {RagSegment} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class RagSegmentDac extends BaseDac {
    constructor(Model) {
        super(Model, 'ragSegmentCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.ragSegmentCode)) {
            params.$and.push({ragSegmentCode: {$in: options.ragSegmentCode}})
        } else if (options.ragSegmentCode) {
            params.$and.push({ragSegmentCode: {$eq: options.ragSegmentCode}})
        }
        if (options.ragCode) {
            params.$and.push({ragCode: {$eq: options.ragCode}})
        }
        if (options.ragMaterialCode) {
            params.$and.push({ragMaterialCode: {$eq: options.ragMaterialCode}})
        }
        if (tools.isArray(options.usage)) {
            params.$and.push({usage: {$in: options.usage}})
        } else if (!tools.isUndefined(options.usage)) {
            params.$and.push({usage: {$eq: options.usage}})
        }
        if (options.keyword) {
            params.$and.push({content: {$regex: new RegExpExt(options.keyword, 'i', true)}})
        }
        if (options.language) {
            params.$and.push({language: {$regex: new RegExpExt(options.language, 'i', true)}})
        }
        return params
    }
}

export default new RagSegmentDac(RagSegment)