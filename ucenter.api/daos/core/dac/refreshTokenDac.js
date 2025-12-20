/**
 * @fileOverview 操作mongodb库中的refreshToken
 * @author xianyang
 * @module
 */

import {RefreshToken} from '../schema/index.js'
import BaseDac from "./BaseDac.js"

export class RefreshTokenDac extends BaseDac {
    constructor(Model) {
        super(Model, 'refreshToken')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        return params
    }
}

export default new RefreshTokenDac(RefreshToken)