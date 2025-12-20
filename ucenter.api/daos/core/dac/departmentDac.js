/**
 * @fileOverview 操作mongodb库中的department
 * @author xianyang
 * @module
 */

import {Department} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class DepartmentDac extends BaseDac {
    constructor(Model) {
        super(Model, 'departmentCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.departmentCode)) {
            params.$and.push({departmentCode: {$in: options.departmentCode}})
        } else if (options.departmentCode) {
            params.$and.push({departmentCode: options.departmentCode})
        }
        if (tools.isExist(options.departmentName)) {
            params.$and.push({departmentName: {$regex: new RegExpExt(options.departmentName, 'i', true)}})
        }
        if (options.parentCode) {
            params.$and.push({parentCode: {$eq: options.parentCode}})
        }
        if (tools.isArray(options.path)) {
            params.$and.push({path: {$in: options.path}})
        } else if (options.path) {
            params.$and.push({path: options.path})
        }
        if (!tools.isUndefined(options.levelNum)) {
            params.$and.push({levelNum: options.levelNum})
        }
        return params
    }
}

export default new DepartmentDac(Department)