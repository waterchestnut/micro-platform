/**
 * @fileOverview 我的应用下的权限相关的接口
 * @author xianyang
 * @module
 */

import {registerClientPrivRoutes} from '../client/ipmi-priv.js'

export const autoPrefix = '/core/client-my/priv'

export default async function (fastify, opts) {
    registerClientPrivRoutes(fastify, opts, ['client-my'])
}
