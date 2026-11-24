/**
 * @fileOverview 桌面小组件内容相关的接口
 * @module
 */

import * as widgetService from '../../../services/widget/widgetService.js'

export const autoPrefix = '/api/core/widget'

export default async function (fastify, opts) {

  fastify.get('/favorite', {
    schema: {
      description: '获取资源收藏小组件内容',
      summary: '资源收藏',
      tags: ['widget'],
      querystring: {
        type: 'object',
        properties: {
          surfaceId: { type: 'string', description: '组件表面ID' },
          homeEndpoint: { type: 'string', description: '首页端点地址' },
        },
        required: ['surfaceId', 'homeEndpoint'],
      },
    },
  }, async (request) => {
    const { surfaceId, homeEndpoint } = request.query
    const data = await widgetService.getFavoriteWidget(request.userInfo, surfaceId, homeEndpoint)
    return { statusCode: 200, code: 0, data }
  })
}
