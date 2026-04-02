/**
 * @fileOverview 操作mongodb库中的grpcSkill
 * @author xianyang 2026/4/1
 * @module
 */

import {GrpcSkill} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class GrpcSkillDac extends BaseDac {
    constructor(Model) {
        super(Model, 'skillCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.skillCode)) {
            params.$and.push({skillCode: {$in: options.skillCode}})
        } else if (options.skillCode) {
            params.$and.push({skillCode: {$eq: options.skillCode}})
        }
        if (tools.isExist(options.skillName)) {
            params.$and.push({skillName: {$regex: new RegExpExt(options.skillName, 'i', true)}})
        }
        if (tools.isArray(options.grpcHost)) {
            params.$and.push({grpcHost: {$in: options.grpcHost}})
        } else if (options.grpcHost) {
            params.$and.push({grpcHost: {$eq: options.grpcHost}})
        }
        if (tools.isArray(options.clientCode)) {
            params.$and.push({clientCode: {$in: options.clientCode}})
        } else if (options.clientCode) {
            params.$and.push({clientCode: {$eq: options.clientCode}})
        }
        if (tools.isArray(options.channels)) {
            params.$and.push({channels: {$in: options.channels}})
        } else if (options.channels) {
            params.$and.push({channels: {$eq: options.channels}})
        }
        if (tools.isArray(options.operatorUserCode)) {
            params.$and.push({'operator.userCode': {$in: options.operatorUserCode}})
        } else if (options.operatorUserCode) {
            params.$and.push({'operator.userCode': options.operatorUserCode})
        }
        return params
    }
}

export default new GrpcSkillDac(GrpcSkill)