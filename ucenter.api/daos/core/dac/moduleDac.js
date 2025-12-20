/**
 * @fileOverview 操作mongodb库中的module
 * @author xianyang
 * @module
 */

import {Module} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js";

export class ModuleDac extends BaseDac {
    constructor(Model) {
        super(Model, 'moduleCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.moduleCode)) {
            params.$and.push({moduleCode: {$in: options.moduleCode}})
        } else if (options.moduleCode) {
            params.$and.push({moduleCode: options.moduleCode})
        }
        if (tools.isExist(options.moduleName)) {
            params.$and.push({moduleName: {$regex: new RegExpExt(options.moduleName, 'i', true)}})
        }
        if (tools.isArray(options.clientCode)) {
            params.$and.push({clientCode: {$in: options.clientCode}})
        } else if (options.clientCode) {
            params.$and.push({clientCode: options.clientCode})
        }
        return params
    }
}

export default new ModuleDac(Module)