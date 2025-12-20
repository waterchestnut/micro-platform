/**
 * @fileOverview 操作mongodb库中的msgInfo
 * @author xianyang
 * @module
 */

import {MsgInfo} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class MsgInfoDac extends BaseDac {
    constructor(Model) {
        super(Model, 'msgCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.msgCode) {
            params.$and.push({msgCode: {$eq: options.msgCode}})
        }
        if (options.sysCode) {
            params.$and.push({sysCode: {$eq: options.sysCode}})
        }
        return params
    }
}

export default new MsgInfoDac(MsgInfo)