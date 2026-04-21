/**
 * @fileOverview 用户首页小组件相关的业务操作
 * @author xianyang
 * @module
 */

import homeWidgetDac from '../../daos/core/dac/homeWidgetDac.js'
import {getWidgetByCode} from './widget.js'
import HomeTypeEnum from '../../daos/core/enum/HomeTypeEnum.js'
import widgetDac from '../../daos/core/dac/widgetDac.js'

/**
 * @description 获取用户首页小组件列表
 * @param {String} userCode 用户标识
 * @param {String} homeEndpoint 首页访问端（pc/mini）
 * @returns {Promise<Array>} 首页小组件列表
 */
export async function getHomeWidgets(userCode, homeEndpoint) {
    let records = await homeWidgetDac.getListByUserCode(userCode, homeEndpoint)

    let addedWidgetCodes = new Set()
    let removedWidgetCodes = new Set()
    records.forEach(r => {
        if (r.homeType === HomeTypeEnum.add.value) {
            addedWidgetCodes.add(r.widgetCode)
        } else if (r.homeType === HomeTypeEnum.remove.value) {
            removedWidgetCodes.add(r.widgetCode)
        }
    })

    let defaultWidgets = await widgetDac.getTop(100, {status: 0, complexFilter: {default2Home: true}}, {order: 1})

    let result = []
    defaultWidgets.forEach(w => {
        if (addedWidgetCodes.has(w.widgetCode)) {
            result.push({widgetCode: w.widgetCode, homeEndpoint, order: w.order, fromUser: true})
        } else if (!removedWidgetCodes.has(w.widgetCode)) {
            result.push({widgetCode: w.widgetCode, homeEndpoint, order: w.order, fromUser: false})
        }
    })

    records.forEach(r => {
        if (r.homeType === HomeTypeEnum.add.value && !result.find(item => item.widgetCode === r.widgetCode)) {
            result.push({...r, fromUser: true})
        }
    })

    result.sort((a, b) => a.order - b.order)
    return result
}

/**
 * @description 添加小组件到用户首页
 * @param {Object} curUserInfo 当前用户
 * @param {String} widgetCode 小组件标识
 * @param {String} homeEndpoint 首页访问端
 * @param {Number} order 排序
 * @returns {Promise<Object>} 添加成功时返回首页小组件对象
 */
export async function addHomeWidget(curUserInfo, widgetCode, homeEndpoint = 'pc', order = 0) {
    if (!widgetCode) {
        throw new Error('缺少小组件标识')
    }

    let widget = await getWidgetByCode(widgetCode)
    if (!widget) {
        throw new Error('小组件不存在')
    }

    let homeWidgetInfo = {
        homeWidgetCode: homeWidgetDac.getHomeWidgetCode(curUserInfo.userCode, widgetCode, homeEndpoint),
        widgetCode,
        userCode: curUserInfo.userCode,
        homeEndpoint,
        homeType: HomeTypeEnum.add.value,
        order
    }

    return homeWidgetDac.upsert(homeWidgetInfo)
}

/**
 * @description 从用户首页移除小组件
 * @param {Object} curUserInfo 当前用户
 * @param {String} widgetCode 小组件标识
 * @param {String} homeEndpoint 首页访问端
 * @param {Number} order 排序
 * @returns {Promise<Object>} 移除结果
 */
export async function removeHomeWidget(curUserInfo, widgetCode, homeEndpoint = 'pc', order = 0) {
    if (!widgetCode) {
        throw new Error('缺少小组件标识')
    }

    let homeWidgetInfo = {
        homeWidgetCode: homeWidgetDac.getHomeWidgetCode(curUserInfo.userCode, widgetCode, homeEndpoint),
        widgetCode,
        userCode: curUserInfo.userCode,
        homeEndpoint,
        homeType: HomeTypeEnum.remove.value,
        order
    }

    return homeWidgetDac.upsert(homeWidgetInfo)
}
