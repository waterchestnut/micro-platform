/**
 * @fileOverview 我的应用下的路由授权相关的接口
 * @author xianyang
 * @module
 */

import {registerClientPageRoutes} from '../client/ipmi-page.js'

export const autoPrefix = '/core/client-my/page'

export default async function (fastify, opts) {
    registerClientPageRoutes(fastify, opts, ['client-my'])
}
