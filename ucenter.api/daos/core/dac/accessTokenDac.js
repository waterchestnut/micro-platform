/**
 * @fileOverview 操作mongodb库中的accessToken
 * @author xianyang
 * @module
 */

import {AccessToken} from '../schema/index.js'
import BaseDac from "./BaseDac.js"

export class AccessTokenDac extends BaseDac {
    constructor(Model) {
        super(Model, 'accessToken')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        return params
    }
}

export default new AccessTokenDac(AccessToken)