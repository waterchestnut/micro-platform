/**
 * @fileOverview 检查请求中是否包含有效widgetCode，以及该小组件是否为当前登录用户所创建
 * @author xianyang
 * @module
 */

import {getWidgetByCode} from '../../../services/core/widget.js'

const tools = app.tools
const logger = app.logger

export default async function (fastify, opts) {
    fastify.addHook('preValidation', async (request, reply) => {
        if (request.routeOptions.url?.startsWith('/core/widget-my/list')) {
            return
        }

        let widgetCode = request.reqParams?.widgetCode
        if (!widgetCode) {
            throw new Error('小组件不存在')
        }
        let widgetInfo = await getWidgetByCode(widgetCode)
        if (widgetInfo?.operator?.userCode !== request.userInfo?.userCode) {
            throw new Error('小组件不存在')
        }
        request.widgetInfo = widgetInfo
    })
}
