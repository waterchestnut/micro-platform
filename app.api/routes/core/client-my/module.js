/**
 * @fileOverview 我的应用下的模块相关的接口
 * @author xianyang
 * @module
 */

import {registerClientModuleRoutes} from '../client/ipmi-module.js'

export const autoPrefix = '/core/client-my/module'

export default async function (fastify, opts) {
    registerClientModuleRoutes(fastify, opts, ['client-my'])
}
