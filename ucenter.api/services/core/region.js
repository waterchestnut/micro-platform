/**
 * @fileOverview 地区相关的业务操作
 * @author xianyang
 * @module
 */

import retSchema from '../../daos/retSchema.js'
import regionDac from '../../daos/core/dac/regionDac.js'

const tools = ucenter.tools
const logger = ucenter.logger
const config = ucenter.config

/**
 * @description 获取所有的区域信息列表
 * @author menglb
 * @param {Object} sort 排序规则
 * @param {Number} [maxLevel=0] 区域的最大层级，0-表示不限制
 * @returns {Promise<Array>} 区域节点列表
 */
export async function getAllRegions(sort = null, maxLevel = 0) {
    sort = sort || {levelNum: 1, orderNum: 1}
    let optionsIn = {}
    if (maxLevel) {
        optionsIn.levelNum = {$lte: maxLevel}
    }
    return regionDac.getTop(100000, {}, sort)
}

/**
 * @description 获取区域直接子节点信息列表
 * @author menglb
 * @param {String} regionCode 地区标识
 * @returns {Promise<Array>} 子区域节点列表
 */
export async function getDirectedChildren(regionCode) {
    return regionDac.getTop(100000, {parentCode: regionCode}, {orderNum: 1})
}

/**
 * @description 获取区域所有(包含自身和递归查询)子节点信息列表
 * @author menglb
 * @param {String} regionCode 地区标识
 * @param {Number} [maxLevel=0] 区域的最大层级，0-表示不限制
 * @returns {Promise<Array>} 子区域节点列表
 */
export async function getChildren(regionCode, maxLevel = 0) {
    let sort = {levelNum: 1, orderNum: 1}
    let optionsIn = {path: regionCode}
    if (maxLevel) {
        optionsIn.levelNum = {$lte: maxLevel}
    }
    return regionDac.getTop(100000, optionsIn, sort)
}

/**
 * @description 获取地区信息（树形结构封装）
 * @author menglb
 * @param {String} parentCode 父地区标识
 * @param {Number} [maxLevel=0] 区域的最大层级，0-表示不限制
 * @returns {Promise<Array>} 带children的区域节点列表
 */
export async function getTreeRegions(parentCode = '', maxLevel = 0) {
    let regions
    let level0List
    if (parentCode) {
        regions = await getChildren(parentCode, maxLevel)
        level0List = regions.filter(_ => _.parentCode === parentCode)
    } else {
        regions = await getAllRegions(null, maxLevel)
        level0List = regions.filter(_ => _.levelNum === 0)
    }

    function format(list) {
        return list.map(_ => {
            let cur = {
                regionCode: _.regionCode,
                regionName: _.regionName,
                code: _.regionCode,
                value: _.regionCode,
                label: _.regionName,
                firstLetter: _.firstLetter,
                letters: _.letters,
                pinyin: _.pinyin,
                orderNum: _.orderNum
            }
            let childList = regions.filter(item => item.parentCode === _.regionCode)
            if (childList?.length) {
                cur.children = format(childList)
            }
            return cur
        })
    }

    return format(level0List)
}

/**
 * @description 获取地区列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 地区数组}
 */
export async function getRegions(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    }
    if (options.total) {
        optionsIn.total = options.total
    }

    return regionDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 添加地区
 * @author menglb
 * @param {Object} userInfo 当前用户
 * @param {Object} region 地区对象
 * @returns {Object} 添加成功时返回新添加的地区对象
 */
export async function addRegion(userInfo, region) {
    if (!region) {
        throw new Error('未传递地区数据')
    }
    if (!region.regionName || !region.regionCode) {
        throw new Error('需要地区名称和地区标识')
    }

    let oldRegion = await regionDac.getByCode(region.regionCode);
    if (oldRegion) {
        throw new Error('地区标识已经存在')
    }

    let regionInfo = {
        regionCode: region.regionCode,
        regionName: region.regionName,
        fullName: region.fullName,
        parentCode: region.parentCode,
        levelNum: region.levelNum,
        status: 0,
        orderNum: region.orderNum,
        typeName: region.typeName,
        adminCode: region.adminCode,
        path: region.path,
        nameEn: region.nameEn,
        shortName: region.shortName,
        shortNameEn: region.shortNameEn,
        firstLetter: region.firstLetter,
        letters: region.letters,
        pinyin: region.pinyin,
        extra: region.extra
    };

    return regionDac.add(regionInfo)
}

/**
 * @description 修改地区
 * @author menglb
 * @param {String} regionCode 地区标识
 * @param {Object} newRegion 新的地区对象
 * @returns {Object} 受影响的行数
 */
export async function updateRegion(regionCode, newRegion) {
    if (!regionCode) {
        throw new Error('缺少地区标识')
    }
    if (!newRegion) {
        throw new Error('没有要更新的数据')
    }

    let region = {
        regionCode,
        regionName: newRegion.regionName,
        fullName: newRegion.fullName,
        parentCode: newRegion.parentCode,
        levelNum: newRegion.levelNum,
        status: newRegion.status,
        orderNum: newRegion.orderNum,
        typeName: newRegion.typeName,
        adminCode: newRegion.adminCode,
        path: newRegion.path,
        nameEn: newRegion.nameEn,
        shortName: newRegion.shortName,
        shortNameEn: newRegion.shortNameEn,
        firstLetter: newRegion.firstLetter,
        letters: newRegion.letters,
        pinyin: newRegion.pinyin,
        extra: newRegion.extra
    };

    return regionDac.update(region)
}

/**
 * @description 删除地区
 * @author menglb
 * @param {String} regionCode 地区标识
 * @returns {Object} 受影响的行数
 */
export async function deleteRegion(regionCode) {
    if (!regionCode) {
        throw new Error('缺少地区标识')
    }

    /** 能否删除的校验 */
    let region = await regionDac.getByCode(regionCode);
    if (!region) {
        throw new Error('地区不存在')
    }

    return regionDac.update({regionCode, status: -1})
}

/** 格式化处理库中全部的数据 */
export async function formatHandleAll() {
    let list = await regionDac.getTop(100000, {})
    list.forEach(region => {
        //region.path = region.path.split('|')
        region.fullName = `${region.regionName}${region.extra || ''}${!region.typeName || region.typeName === '国家' ? '' : region.typeName}`
        region.status = 0
        region.insertTime = new Date()
        region.updateTime = new Date()
    })
    await regionDac.bulkUpdate(list)
    return 'done'
}