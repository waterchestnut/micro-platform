/**
 * @fileOverview 操作mongodb库中的homeClient
 * @author xianyang
 * @module
 */

import {HomeClient} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class HomeClientDac extends BaseDac {
    constructor(Model) {
        super(Model, 'homeClientCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.clientCode)) {
            params.$and.push({clientCode: {$in: options.clientCode}})
        } else if (options.clientCode) {
            params.$and.push({clientCode: options.clientCode})
        }
        if (tools.isArray(options.userCode)) {
            params.$and.push({userCode: {$in: options.userCode}})
        } else if (options.userCode) {
            params.$and.push({userCode: options.userCode})
        }
        return params
    }

    getListByUserCode(userCode) {
        let params = this.assembleParams({userCode})
        return this._Model.find(params.$and.length ? params : {}).sort({order: 1}).lean().exec()
    }
}

export default new HomeClientDac(HomeClient)