/**
 * @fileOverview 操作mongodb库中的memoryEntity
 * @module daos/core/dac/memoryEntityDac
 */

import {MemoryEntity} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class MemoryEntityDac extends BaseDac {
    constructor(Model) {
        super(Model, 'entityCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.entityCode) {
            params.$and.push({entityCode: {$eq: options.entityCode}})
        }
        if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        if (options.name) {
            params.$and.push({
                $or: [
                    {name: options.name},
                    {aliases: options.name},
                ]
            })
        }
        if (tools.isExist(options.dirty)) {
            params.$and.push({dirty: !!options.dirty})
        }
        return params
    }
}

export default new MemoryEntityDac(MemoryEntity)
