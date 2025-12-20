/**
 * @fileOverview 操作mongodb库中的agentLog
 * @author xianyang
 * @module
 */

import {AgentLog} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class AgentLogDac extends BaseDac {
    constructor(Model) {
        super(Model, 'logCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.logCode) {
            params.$and.push({logCode: {$eq: options.logCode}})
        }
        if (options.agentCode) {
            params.$and.push({agentCode: {$eq: options.agentCode}})
        }
        if (tools.isExist(options.group)) {
            params.$and.push({group: {$regex: new RegExpExt(options.group, 'i', true)}})
        }
        return params
    }
}

export default new AgentLogDac(AgentLog)