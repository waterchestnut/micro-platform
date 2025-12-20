/**
 * @fileOverview 临时验证功能
 * @author xianyang 2025/2/8
 * @module
 */

import './init.js'
import {getApisixRoutes, updateApisixRoute, loadAuthServerless} from './services/core/apisix.js'
import {getModuleList} from './grpc/clients/module.js'
import {getMiniShowClients, getPCShowClients} from './services/core/client.js'

console.log(await getMiniShowClients())