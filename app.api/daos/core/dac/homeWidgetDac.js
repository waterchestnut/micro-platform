/**
 * @fileOverview 操作mongodb库中的homeWidget
 * @author xianyang
 * @module
 */

import {HomeWidget} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'
import {md5} from '../../../tools/security.js'

export class HomeWidgetDac extends BaseDac {
    constructor(Model) {
        super(Model, 'homeWidgetCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.widgetCode)) {
            params.$and.push({widgetCode: {$in: options.widgetCode}})
        } else if (options.widgetCode) {
            params.$and.push({widgetCode: options.widgetCode})
        }
        if (tools.isArray(options.userCode)) {
            params.$and.push({userCode: {$in: options.userCode}})
        } else if (options.userCode) {
            params.$and.push({userCode: options.userCode})
        }
        return params
    }

    getListByUserCode(userCode, homeEndpoint) {
        let filter = {userCode}
        if (homeEndpoint) {
            filter.homeEndpoint = homeEndpoint
        }
        return this._Model.find(filter).lean().exec()
    }

    getHomeWidgetCode(userCode, widgetCode, homeEndpoint) {
        return md5(userCode + widgetCode + homeEndpoint)
    }
}

export default new HomeWidgetDac(HomeWidget)
