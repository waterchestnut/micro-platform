/**
 * @fileOverview 操作mongodb库中的dataset
 * @module
 */

import {Dataset} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class DatasetDac extends BaseDac {
    constructor(Model) {
        super(Model, 'resCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.source)) {
            params.$and.push({source: {$in: options.source}})
        } else if (options.source) {
            params.$and.push({source: {$eq: options.source}})
        }

        return params
    }
}

export default new DatasetDac(Dataset)