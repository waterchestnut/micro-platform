/**
 * @fileOverview 操作mongodb库中的agentTask
 * @author xianyang
 * @module
 */

import {AgentTask} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class AgentTaskDac extends BaseDac {
    constructor(Model) {
        super(Model, 'agentCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.agentCode)) {
            params.$and.push({agentCode: {$in: options.agentCode}})
        } else if (options.agentCode) {
            params.$and.push({agentCode: {$eq: options.agentCode}})
        }
        if (tools.isExist(options.title)) {
            params.$and.push({title: {$regex: new RegExpExt(options.title, 'i', true)}})
        }
        return params
    }
}

export default new AgentTaskDac(AgentTask)