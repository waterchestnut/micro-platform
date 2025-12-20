/**
 * @fileOverview 操作mongodb库中的job
 * @author xianyang
 * @module
 */

import {Job} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class JobDac extends BaseDac {
    constructor(Model) {
        super(Model, 'jobCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.jobCode)) {
            params.$and.push({jobCode: {$in: options.jobCode}})
        } else if (options.jobCode) {
            params.$and.push({jobCode: options.jobCode})
        }
        if (tools.isExist(options.jobName)) {
            params.$and.push({jobName: {$regex: new RegExpExt(options.jobName, 'i', true)}})
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

export default new JobDac(Job)