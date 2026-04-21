/**
 * @fileOverview 桌面小组件相关的业务操作
 * @author xianyang
 * @module
 */

import widgetDac from '../../daos/core/dac/widgetDac.js'
import {checkCodeField} from '../../tools/check.js'

const tools = app.tools

/**
 * @description 获取小组件列表
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 小组件数组}
 */
export async function getWidgets(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {order: -1, updateTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return widgetDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 根据标识读取小组件
 * @param {String} widgetCode 小组件标识
 * @returns {Promise<Object>} 小组件对象
 */
export async function getWidgetByCode(widgetCode) {
    return widgetDac.getByCode(widgetCode)
}

/**
 * @description 添加小组件
 * @param {Object} curUserInfo 当前用户
 * @param {Object} widget 小组件对象
 * @returns {Promise<Object>} 添加成功时返回新添加的小组件对象
 */
export async function addWidget(curUserInfo, widget) {
    if (!widget) {
        throw new Error('未传递小组件数据')
    }
    if (!widget.widgetName || !widget.clientCode) {
        throw new Error('需要小组件名称和所属应用标识')
    }

    checkWidgetField(widget)

    let oldWidget = await widgetDac.getByCode(widget.widgetCode)
    if (oldWidget) {
        throw new Error('小组件标识已存在')
    }

    let newWidgetInfo = {
        ...widget,
        widgetCode: widget.widgetCode,
        clientCode: widget.clientCode,
        widgetName: widget.widgetName,
        logoUrl: widget.logoUrl,
        apiUrl: widget.apiUrl,
        miniApiUrl: widget.miniApiUrl,
        description: widget.description,
        order: widget.order || 0,
        default2Home: widget.default2Home !== undefined ? widget.default2Home : true,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
        tags: widget.tags
    }

    return widgetDac.add(newWidgetInfo)
}

/**
 * @description 修改小组件
 * @param {Object} curUserInfo 当前用户
 * @param {String} widgetCode 小组件标识
 * @param {Object} newWidget 新的小组件对象
 * @returns {Promise<Object>} 受影响的行数
 */
export async function updateWidget(curUserInfo, widgetCode, newWidget) {
    if (!widgetCode) {
        throw new Error('缺少小组件标识')
    }
    if (!newWidget) {
        throw new Error('没有要更新的数据')
    }

    checkWidgetField(newWidget)

    let widget = {
        widgetCode,
        widgetName: newWidget.widgetName,
        logoUrl: newWidget.logoUrl,
        apiUrl: newWidget.apiUrl,
        miniApiUrl: newWidget.miniApiUrl,
        description: newWidget.description,
        order: newWidget.order,
        default2Home: newWidget.default2Home,
        tags: newWidget.tags,
    }

    return widgetDac.update(widget)
}

/**
 * @description 删除小组件
 * @param {Object} curUserInfo 当前用户
 * @param {String} widgetCode 小组件标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteWidget(curUserInfo, widgetCode) {
    if (!widgetCode) {
        throw new Error('缺少小组件标识')
    }

    return widgetDac.update({widgetCode, status: -1})
}

/**
 * @description 启用小组件
 * @param {Object} curUserInfo 当前用户
 * @param {String} widgetCode 小组件标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function enableWidget(curUserInfo, widgetCode) {
    if (!widgetCode) {
        throw new Error('缺少小组件标识')
    }

    return widgetDac.update({widgetCode, status: 0})
}

/**
 * @description 禁用小组件
 * @param {Object} curUserInfo 当前用户
 * @param {String} widgetCode 小组件标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function disableWidget(curUserInfo, widgetCode) {
    if (!widgetCode) {
        throw new Error('缺少小组件标识')
    }

    return widgetDac.update({widgetCode, status: 1})
}

/**
 * @description 校验小组件相关字段的合法性
 * @param {Object} widgetInfo 小组件信息
 * @returns {Boolean} 校验是否通过
 */
function checkWidgetField(widgetInfo) {
    if (!widgetInfo) {
        return true
    }
    if (widgetInfo.widgetCode) {
        checkCodeField(widgetInfo.widgetCode, '小组件标识')
    }
    if (widgetInfo.widgetName) {
        if (!/^.{2,24}$/g.test(widgetInfo.widgetName)) {
            throw new Error('小组件名称至少2个字符，且总长度不能超过24个字符')
        }
    }
    return true
}

/**
 * @description 获取PC端展示的小组件（需要apiUrl不为空）
 * @param {String} clientCode 应用标识
 * @returns {Promise<Array>} 小组件列表
 */
export async function getPCShowWidgets(clientCode) {
    let query = {
        status: 0,
        complexFilter: [{apiUrl: {$ne: '', $exists: true},}]
    }
    if (clientCode) {
        query.clientCode = clientCode
    }
    let rows = await widgetDac.getTop(2000, query, {order: 1, updateTime: -1})

    return formatPublicWidgets(rows)
}

/**
 * @description 获取小程序端展示的小组件（需要miniApiUrl不为空）
 * @param {String} clientCode 应用标识
 * @returns {Promise<Array>} 小组件列表
 */
export async function getMiniShowWidgets(clientCode) {
    let query = {
        status: 0,
        complexFilter: [{miniApiUrl: {$ne: '', $exists: true}}]
    }
    if (clientCode) {
        query.clientCode = clientCode
    }
    let rows = await widgetDac.getTop(2000, query, {order: 1, updateTime: -1})

    return formatPublicWidgets(rows)
}

/**
 * @description 格式化开放的小组件信息
 * @param {Array} widgets 小组件列表
 * @returns {Array} 格式化后的小组件列表
 */
export function formatPublicWidgets(widgets) {
    if (!widgets?.length) {
        return widgets
    }
    return widgets?.map(row => {
        let item = {...row}
        delete item._id
        delete item.operator
        return item
    })
}
