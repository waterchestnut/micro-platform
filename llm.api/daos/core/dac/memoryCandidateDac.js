/**
 * @fileOverview 操作mongodb库中的memoryCandidate
 * @module daos/core/dac/memoryCandidateDac
 */

import {MemoryCandidate} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class MemoryCandidateDac extends BaseDac {
    constructor(Model) {
        super(Model, 'candidateCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.candidateCode) {
            params.$and.push({candidateCode: {$eq: options.candidateCode}})
        }
        if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        if (options.state) {
            params.$and.push({state: {$eq: options.state}})
        }
        if (options.atomCode) {
            params.$and.push({atomCode: {$eq: options.atomCode}})
        }
        if (tools.isArray(options.eventCodes)) {
            params.$and.push({eventCodes: {$in: options.eventCodes}})
        }
        return params
    }
}

export default new MemoryCandidateDac(MemoryCandidate)
