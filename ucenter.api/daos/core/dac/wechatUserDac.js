/**
 * @fileOverview 微信用户关联映射的数据操作类
 * @author
 * @module
 */

import {WechatUser} from '../schema/index.js'
import BaseDac from './BaseDac.js'

export class WechatUserDac extends BaseDac {
    constructor(Model) {
        super(Model, 'openId')
    }

    /**
     * @description 根据微信openId获取绑定记录
     * @param {String} openId 微信openId
     * @returns {Promise<Object|null>}
     */
    async getByOpenId(openId) {
        return this.getOneByFilter({openId})
    }

    /**
     * @description 根据平台userCode获取绑定记录
     * @param {String} userCode 平台用户标识
     * @returns {Promise<Object|null>}
     */
    async getByUserCode(userCode) {
        return this.getOneByFilter({userCode})
    }

    /**
     * @description 根据unionId获取绑定记录
     * @param {String} unionId 微信unionId
     * @returns {Promise<Object|null>}
     */
    async getByUnionId(unionId) {
        return this.getOneByFilter({unionId})
    }
}

export default new WechatUserDac(WechatUser)