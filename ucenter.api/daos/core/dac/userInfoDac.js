/**
 * @fileOverview 操作mongodb库中的userInfo
 * @author xianyang
 * @module
 */

import {UserInfo} from '../schema/index.js'
import BaseDac from "./BaseDac.js"
import * as tools from "../../../tools/index.js"

export class UserInfoDac extends BaseDac {
    constructor(Model) {
        super(Model, 'userCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (options.userCodes) {
            params.$and.push({userCode: {$in: options.userCodes}})
        }
        if (options.loginName) {
            params.$and.push({loginName: {$eq: options.loginName}})
        }
        if (options.mobile) {
            params.$and.push({mobile: {$eq: options.mobile}})
        }
        if (options.email) {
            params.$and.push({email: {$eq: options.email}})
        }
        if (options.orgCode) {
            params.$and.push({orgCodes: options.orgCode})
        }
        if (options.mainJobCode) {
            params.$and.push({mainJobCode: {$eq: options.mainJobCode}})
        }
        if (tools.isExist(options.realName)) {
            params.$and.push({realName: {$regex: new RegExpExt(options.realName, 'i', true)}})
        }
        if (tools.isExist(options.nickName)) {
            params.$and.push({nickName: {$regex: new RegExpExt(options.nickName, 'i', true)}})
        }
        return params
    }

    /**
     * @description 根据手机号获取用户名
     * @author menglb
     * @param {String} mobile 手机号
     * @returns {Promise<String|null>} 用户名或null
     */
    async getUsernameByMobile(mobile) {
        const filter = { mobile };
        const user = await this.findOne(filter);
        return user ? user.loginName : null;
    }


}

export default new UserInfoDac(UserInfo)