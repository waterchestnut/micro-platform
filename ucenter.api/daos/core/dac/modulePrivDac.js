/**
 * @fileOverview 操作mongodb库中的modulePriv
 * @author xianyang
 * @module
 */

import {ModulePriv} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js";

export class ModulePrivDac extends BaseDac {
    constructor(Model) {
        super(Model, 'modulePrivCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.modulePrivCode)) {
            params.$and.push({modulePrivCode: {$in: options.modulePrivCode}})
        } else if (options.modulePrivCode) {
            params.$and.push({modulePrivCode: options.modulePrivCode})
        }
        if (tools.isExist(options.modulePrivName)) {
            params.$and.push({modulePrivName: {$regex: new RegExpExt(options.modulePrivName, 'i', true)}})
        }
        if (tools.isArray(options.moduleCode)) {
            params.$and.push({moduleCode: {$in: options.moduleCode}})
        } else if (options.moduleCode) {
            params.$and.push({moduleCode: options.moduleCode})
        }
        if (tools.isArray(options.clientCode)) {
            params.$and.push({clientCode: {$in: options.clientCode}})
        } else if (options.clientCode) {
            params.$and.push({clientCode: options.clientCode})
        }
        return params
    }
}

export default new ModulePrivDac(ModulePriv)