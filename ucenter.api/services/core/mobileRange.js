/**
 * @fileOverview 号码归属地相关的业务操作
 * @author xianyang
 * @module
 */

import mobileRangeDac from '../../daos/core/dac/mobileRangeDac.js'

/**
 * @description 判断号码的归属地
 * @author xianyang
 * @param {String} phone 手机或固话号码
 * @returns {Promise<{provName: String, cityName: String}|null>} 省市信息
 */
export async function checkBelonging(phone) {
    if (!phone || phone.length < 4 || (!phone.startsWith('0') && phone.length < 7)) {
        return null
    }
    if (phone.startsWith('0')) {
        let areaCode1 = phone.substring(0, 3)
        let areaCode2 = phone.substring(0, 4)
        let record = await mobileRangeDac.getOneByFilter({$or: [{areaCode: areaCode1}, {areaCode: areaCode2}]})
        if (!record) {
            return null
        }
        return {
            provName: record.provName,
            cityName: record.cityName
        }
    }

    let segment = parseInt(phone.substring(0, 7))
    let record = await mobileRangeDac.getOneByFilter({$and: [{startNumber: {$lte: segment}}, {endNumber: {$gte: segment}}]})
    if (!record) {
        return null
    }
    return {
        provName: record.provName,
        cityName: record.cityName
    }
}