/**
 * @fileOverview 操作知识库中的ragOperationLog
 * @module
 */

import {RagOperationLog} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class RagOperationLogDac extends BaseDac {
    constructor(Model) {
        super(Model, 'logCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.ragCode) {
            params.$and.push({ragCode: {$eq: options.ragCode}})
        }
        if (options.logType) {
            params.$and.push({logType: {$eq: options.logType}})
        }
        return params
    }
}

export default new RagOperationLogDac(RagOperationLog)
