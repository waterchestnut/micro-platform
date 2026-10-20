/**
 * @fileOverview 操作mongodb库中的memoryJournal
 * @module daos/core/dac/memoryJournalDac
 */

import {MemoryJournal} from '../schema/index.js'
import BaseDac from './BaseDac.js'

export class MemoryJournalDac extends BaseDac {
    constructor(Model) {
        super(Model, 'journalCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        if (options.targetCode) {
            params.$and.push({targetCode: {$eq: options.targetCode}})
        }
        if (options.targetType) {
            params.$and.push({targetType: {$eq: options.targetType}})
        }
        if (options.op) {
            params.$and.push({op: {$eq: options.op}})
        }
        if (options.actor) {
            params.$and.push({actor: {$eq: options.actor}})
        }
        return params
    }
}

export default new MemoryJournalDac(MemoryJournal)
