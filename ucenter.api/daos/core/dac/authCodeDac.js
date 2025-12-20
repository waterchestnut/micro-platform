/**
 * @fileOverview 操作mongodb库中的authCode
 * @author xianyang
 * @module
 */

import {AuthCode} from '../schema/index.js'
import BaseDac from "./BaseDac.js"

export class AuthCodeDac extends BaseDac {
    constructor(Model) {
        super(Model, 'authCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        return params
    }
}

export default new AuthCodeDac(AuthCode)