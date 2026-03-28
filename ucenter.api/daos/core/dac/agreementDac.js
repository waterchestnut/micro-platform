/**
 * @fileOverview 操作mongodb库中的agreement
 * @author menglb
 * @module
 */

import {Agreement} from '../schema/index.js'
import BaseDac from "./BaseDac.js"

export class AgreementDac extends BaseDac {
    constructor(Model) {
        super(Model, 'agreementCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.agreementCode) {
            params.$and.push({agreementCode: {$eq: options.agreementCode}})
        }
        if (options.type) {
            params.$and.push({type: {$eq: options.type}})
        }
        return params
    }

    async getLatestByType(type) {
        return await this._Model.findOne({type, status: 0}).sort({version: -1}).lean().exec()
    }
}

export default new AgreementDac(Agreement)
