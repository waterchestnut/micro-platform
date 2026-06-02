/**
 * @fileOverview 操作mongodb库中的ragInfo
 * @author xianyang
 * @module
 */

import {RagInfo} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class RagInfoDac extends BaseDac {
    constructor(Model) {
        super(Model, 'ragCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.ragCode) {
            params.$and.push({ragCode: {$eq: options.ragCode}})
        }
        if (options.ragType) {
            params.$and.push({ragType: {$eq: options.ragType}})
        }
        if (tools.isExist(options.title)) {
            params.$and.push({title: {$regex: new RegExpExt(options.title, 'i', true)}})
        }
        if (tools.isArray(options.operatorUserCode)) {
            params.$and.push({'operator.userCode': {$in: options.operatorUserCode}})
        } else if (options.operatorUserCode) {
            params.$and.push({'operator.userCode': options.operatorUserCode})
        }
        if (options.managedMemberUserCode) {
            params.$and.push({
                members: {
                    $elemMatch: {
                        userCode: options.managedMemberUserCode,
                        memberType: {$in: ['owner', 'admin']}
                    }
                }
            })
        }
        if (options.joinedOrPendingUserCode) {
            params.$and.push({
                $or: [
                    {'members.userCode': options.joinedOrPendingUserCode},
                    {applications: {$elemMatch: {userCode: options.joinedOrPendingUserCode, status: 0}}}
                ]
            })
        }

        return params
    }
}

export default new RagInfoDac(RagInfo)