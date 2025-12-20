/**
 * @fileOverview MongoDB数据层操作的工具类方法集合
 * @author xianyang
 * @module daos/core/utils
 */

import * as tools from '../../tools/index.js'

const utils = {
    getUpdateSets: function (newInfo, attrOpen = false, notUpdateTime = false) {
        let update = {$set: {}, $unset: {}}
        if (!notUpdateTime) {
            update.$set.updateTime = new Date()
        }
        for (let key in newInfo) {
            if (key === 'insertTime' || key === '_id' || key === '__v' || key === '__options') {
                continue
            }
            if (newInfo.hasOwnProperty(key)) {
                update.$set = Object.assign(update.$set, attrOpen || newInfo[key]?.$unset ? utils.getSetKeyValue(key, newInfo[key]) : {[key]: newInfo[key]})
            }
            if (newInfo.hasOwnProperty(key)) {
                update.$unset = Object.assign(update.$unset, utils.getUnSetKeyValue(key, newInfo[key]))
            }
        }
        if (!Object.keys(update.$unset).length) {
            delete update.$unset
        }

        return update
    },
    getSetKeyValue: function (key, val) {
        if (val?.$unset) {
            return {}
        }
        if (tools.isObject(val) && !val.$notRecursion) {
            let ret = {}
            for (let subKey in val) {
                if (val.hasOwnProperty(subKey)) {
                    let subRet = utils.getSetKeyValue(subKey, val[subKey])
                    for (let retKey in subRet) {
                        if (subRet.hasOwnProperty(retKey)) {
                            ret[key + '.' + retKey] = subRet[retKey]
                        }
                    }
                }
            }
            return ret
        }
        if (val?.$notRecursion) {
            delete val.$notRecursion
        }
        if (tools.isString(val) && val.length === 24 && val.endsWith('Z') && val.includes('T')) {
            val = new Date(val)
        }
        return notNeedUpdate(val) ? {} : {[key]: val}
    },
    getUnSetKeyValue: function (key, val) {
        if (val?.$unset) {
            return {[key]: 1}
        }
        if (tools.isObject(val) && !val.$notRecursion) {
            let ret = {}
            for (let subKey in val) {
                if (val.hasOwnProperty(subKey)) {
                    let subRet = utils.getUnSetKeyValue(subKey, val[subKey])
                    for (let retKey in subRet) {
                        if (subRet.hasOwnProperty(retKey)) {
                            ret[key + '.' + retKey] = subRet[retKey]
                        }
                    }
                }
            }
            return ret
        }

        return {}
    }
}

function notNeedUpdate(val) {
    return ['[object Undefined]', '[object Null]'].includes(Object.prototype.toString.call(val))
}

export default utils