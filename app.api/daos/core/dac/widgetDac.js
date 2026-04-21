/**
 * @fileOverview 操作mongodb库中的widget
 * @author xianyang
 * @module
 */

import {Widget} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class WidgetDac extends BaseDac {
    constructor(Model) {
        super(Model, 'widgetCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.widgetCode)) {
            params.$and.push({widgetCode: {$in: options.widgetCode}})
        } else if (options.widgetCode) {
            params.$and.push({widgetCode: options.widgetCode})
        }
        if (tools.isArray(options.clientCode)) {
            params.$and.push({clientCode: {$in: options.clientCode}})
        } else if (options.clientCode) {
            params.$and.push({clientCode: options.clientCode})
        }
        if (tools.isExist(options.widgetName)) {
            params.$and.push({widgetName: {$regex: new RegExpExt(options.widgetName, 'i', true)}})
        }
        if (tools.isArray(options.operatorUserCode)) {
            params.$and.push({'operator.userCode': {$in: options.operatorUserCode}})
        } else if (options.operatorUserCode) {
            params.$and.push({'operator.userCode': options.operatorUserCode})
        }
        return params
    }
}

export default new WidgetDac(Widget)
