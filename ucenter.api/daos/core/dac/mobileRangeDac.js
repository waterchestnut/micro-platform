/**
 * @fileOverview 操作mongodb库中的mobileRange
 * @author xianyang
 * @module
 */

import {MobileRange} from '../schema/index.js'
import BaseDac from "./BaseDac.js"

export class MobileRangeDac extends BaseDac {
    constructor(Model) {
        super(Model, 'mobileRangeCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        return params
    }
}

export default new MobileRangeDac(MobileRange)