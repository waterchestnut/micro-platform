/**
 * @fileOverview 用户首页小组件相关的业务操作
 * @author xianyang
 * @module
 */

import homeWidgetDac from '../../daos/core/dac/homeWidgetDac.js'
import {getWidgetByCode} from './widget.js'
import HomeTypeEnum from '../../daos/core/enum/HomeTypeEnum.js'
import clientDac from '../dac/clientDac.js'
import widgetDac from '../../daos/core/dac/widgetDac.js'

/**
 * @description 合并小组件展示字段（注册表 widget 为主，用户排布记录无 widgetName/apiUrl 等字段）
 * @param {Object} widget 注册表小组件对象
 * @param {Object} record 用户排布记录
 * @param {Number} order 生效顺序（用户记录优先）
 * @param {String} homeEndpoint 首页访问端
 * @returns {Object} 合并后的首页小组件
 */
function mergeWidgetFields(widget, record, order, homeEndpoint, clientEndpointsMap) {
    return {...widget, widgetCode: widget.widgetCode, homeEndpoint, order, fromUser: true, endpoints: clientEndpointsMap?.get(widget.clientCode)}
}

/**
 * @description 获取用户首页小组件列表
 * @param {String} userCode 用户标识
 * @param {String} homeEndpoint 首页访问端（pc/mini）
 * @returns {Promise<Array>} 首页小组件列表
 */
export async function getHomeWidgets(userCode, homeEndpoint) {
    let records = await homeWidgetDac.getListByUserCode(userCode, homeEndpoint)

    let addedRecords = new Map()
    let removedWidgetCodes = new Set()
    records.forEach(r => {
        if (r.homeType === HomeTypeEnum.add.value) {
            addedRecords.set(r.widgetCode, r)
        } else if (r.homeType === HomeTypeEnum.remove.value) {
            removedWidgetCodes.add(r.widgetCode)
        }
    })

    let defaultWidgets = await widgetDac.getTop(100, {status: 0, complexFilter: {default2Home: true}}, {order: 1})

    let result = []
    defaultWidgets.forEach(w => {
        let added = addedRecords.get(w.widgetCode)
        if (added) {
            // 用户显式添加过默认卡：以用户排布顺序为准
            result.push(mergeWidgetFields(w, added, added.order ?? w.order, homeEndpoint))
            addedRecords.delete(w.widgetCode)
        } else if (!removedWidgetCodes.has(w.widgetCode)) {
            result.push({...w, widgetCode: w.widgetCode, homeEndpoint, order: w.order, fromUser: false})
        }
    })

    // 用户添加的非默认卡：需从注册表补齐 widgetName/apiUrl 等展示字段
    let extraCodes = [...addedRecords.keys()]
    if (extraCodes.length > 0) {
        let extraWidgets = await widgetDac.getTop(extraCodes.length, {status: 0, widgetCode: extraCodes})
        extraWidgets.forEach(w => {
            let added = addedRecords.get(w.widgetCode)
            if (added) {
                result.push(mergeWidgetFields(w, added, added.order ?? 100, homeEndpoint))
            }
        })
    }

    // 联查所属应用 pc 端访问地址（底座消费端派生默认图标用，产品端忽略不影响）
    let clientCodes = [...new Set(result.map(w => w.clientCode).filter(Boolean))]
    if (clientCodes.length > 0) {
        let clients = await clientDac.getTop(clientCodes.length, {complexFilter: [{clientCode: {$in: clientCodes}}]})
        let endpointMap = new Map()
        for (let cl of (clients || [])) {
            let pc = (cl.endpoints || []).filter(e => e.endpointType === 'pc' || e.endpointType === 'pcIframe')
            if (pc.length) endpointMap.set(cl.clientCode, pc)
        }
        for (let w of result) {
            w.endpoints = endpointMap.get(w.clientCode)
        }
    }

    result.sort((a, b) => a.order - b.order)
    return result
}

/**
 * @description 批量保存用户首页小组件（目标集合全量语义：新增/保序项记 add，落选项记 remove）
 * @param {Object} curUserInfo 当前用户
 * @param {String[]} widgetCodes 目标小组件标识数组（顺序即排布顺序）
 * @param {String} homeEndpoint 首页访问端
 * @returns {Promise<Object[]>} 保存结果
 */
export async function saveHomeWidgets(curUserInfo, widgetCodes, homeEndpoint = 'pc') {
    let targetCodes = widgetCodes || []

    let widgets = await widgetDac.getTop(targetCodes.length, {status: 0, widgetCode: targetCodes})

    let upsertInfos = []
    for (let i = 0; i < targetCodes.length; i++) {
        let widgetCode = targetCodes[i]
        let widget = widgets.find(w => w.widgetCode === widgetCode)
        if (!widget) {
            continue
        }

        let homeWidgetInfo = {
            homeWidgetCode: homeWidgetDac.getHomeWidgetCode(curUserInfo.userCode, widgetCode, homeEndpoint),
            widgetCode,
            userCode: curUserInfo.userCode,
            homeEndpoint,
            homeType: HomeTypeEnum.add.value,
            order: i
        }
        upsertInfos.push(homeWidgetInfo)
    }

    // 全量语义：当前在首页但目标集合中没有的卡，落 remove 记录（含默认卡）
    let current = await getHomeWidgets(curUserInfo.userCode, homeEndpoint)
    let targetSet = new Set(targetCodes)
    for (let w of current) {
        if (!targetSet.has(w.widgetCode)) {
            upsertInfos.push({
                homeWidgetCode: homeWidgetDac.getHomeWidgetCode(curUserInfo.userCode, w.widgetCode, homeEndpoint),
                widgetCode: w.widgetCode,
                userCode: curUserInfo.userCode,
                homeEndpoint,
                homeType: HomeTypeEnum.remove.value,
                order: 0,
            })
        }
    }

    if (!upsertInfos.length) {
        return []
    }
    return homeWidgetDac.bulkUpdate(upsertInfos)
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
