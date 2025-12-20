/**
 * @fileOverview 操作mongodb库中的ragChunk
 * @author xianyang
 * @module
 */

import {RagChunk} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class RagChunkDac extends BaseDac {
    constructor(Model) {
        super(Model, 'ragChunkCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.ragChunkCode)) {
            params.$and.push({ragChunkCode: {$in: options.ragChunkCode}})
        } else if (options.ragChunkCode) {
            params.$and.push({ragChunkCode: {$eq: options.ragChunkCode}})
        }
        if (options.ragCode) {
            params.$and.push({ragCode: {$eq: options.ragCode}})
        }
        if (options.ragMaterialCode) {
            params.$and.push({ragMaterialCode: {$eq: options.ragMaterialCode}})
        }
        if (tools.isArray(options.ragSegmentCode)) {
            params.$and.push({ragSegmentCode: {$in: options.ragSegmentCode}})
        } else if (options.ragSegmentCode) {
            params.$and.push({ragSegmentCode: {$eq: options.ragSegmentCode}})
        }
        if (tools.isArray(options.usage)) {
            params.$and.push({usage: {$in: options.usage}})
        } else if (!tools.isUndefined(options.usage)) {
            params.$and.push({usage: {$eq: options.usage}})
        }
        return params
    }
}

export default new RagChunkDac(RagChunk)