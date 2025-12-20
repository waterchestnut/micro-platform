/**
 * @fileOverview 操作mongodb库中的group
 * @author xianyang
 * @module
 */

import {Group} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class GroupDac extends BaseDac {
    constructor(Model) {
        super(Model, 'groupCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.groupCode)) {
            params.$and.push({groupCode: {$in: options.groupCode}})
        } else if (options.groupCode) {
            params.$and.push({groupCode: options.groupCode})
        }
        if (tools.isExist(options.groupName)) {
            params.$and.push({groupName: {$regex: new RegExpExt(options.groupName, 'i', true)}})
        }
        if (tools.isExist(options.description)) {
            params.$and.push({description: {$regex: new RegExpExt(options.description, 'i', true)}})
        }
        return params
    }
}

export default new GroupDac(Group)