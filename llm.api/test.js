/**
 * @fileOverview 临时验证功能
 * @author xianyang 2025/2/8
 * @module
 */

import './init.js'
import {insertSubAgentTask} from './services/core/agentTask.js'
import {autoTrans, pictureTrans} from './services/core/trans.js'
import {llmRagSearch} from './grpc/clients/resourceRag.js'
import {statConversationByChannelGroup} from './services/core/conversation.js'

let ret = await pictureTrans('https://apisix.local/doc/file/download/2511.15973v1-13.png?fileCode=860cf4cfb51b451a8a82cdaaf6780c74')
console.log(ret)