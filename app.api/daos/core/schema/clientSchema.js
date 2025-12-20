/**
 * @fileOverview 应用的结构
 * @author xianyang 2024/5/19
 * @module
 */

import mongoose from 'mongoose'
import StatusEnum from '../enum/StatusEnum.js'
import ClientTypeEnum from '../enum/ClientTypeEnum.js'
import Tag from '../definition/Tag.js'
import Endpoint from '../definition/Endpoint.js'
import Upstream from '../definition/Upstream.js'
import PlatformTypeEnum from '../enum/PlatformTypeEnum.js'
import Operator from '../definition/Operator.js'

const Schema = mongoose.Schema
const tools = app.tools

/**
 * @description 定义client的结构
 * @author xianyang
 * @property {String} clientCode 唯一标识
 * @property {String} clientName 应用名称
 * @property {Number} status 状态：参见StatusEnum
 * @property {String} description 应用描述
 * @property {Schema.Types.Mixed} operator 应用创建者
 * @property {Schema.Types.Mixed[]} tags 标签，参见Tag
 * @property {String} clientType 应用类型
 * @property {Schema.Types.Mixed[]} endpoints 访问端，参见Endpoint
 * @property {Boolean} needAuthProxy 是否需要代理权限验证
 * @property {Schema.Types.Mixed[]} upstreams 上游节点，参见Upstream
 * @property {Number} order 应用在平台展示的顺序（值越小排序越靠前）
 * @property {Boolean} needAuth2Show 是否需要分配权限才显示
 * @property {String} platformType 平台类型，参见PlatformTypeEnum
 * @property {String[]} toClients 获得本应用授权的其他应用标识列表
 * @property {String} logoUrl 应用的图标地址
 * @property {Date} insertTime 创建时间
 * @property {Date} updateTime 最近更新时间
 */
const clientSchema = new Schema({
    clientCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '应用标识',
        required: true
    },
    clientName: {type: String, description: '应用名称'},
    status: {type: Number, default: 0, description: '状态', enum: StatusEnum.toValues()},
    description: {type: String, description: '应用描述'},
    operator: {type: Operator, description: '应用创建者'},
    tags: {type: [Tag], description: '标签'},
    clientType: {type: String, default: 'selfBuild', description: '应用类型', enum: ClientTypeEnum.toValues()},
    endpoints: {type: [Endpoint], description: '访问端'},
    needAuthProxy: {type: Boolean, default: true, description: '是否需要代理权限验证'},
    upstreams: {type: [Upstream], description: '上游节点'},
    order: {type: Number, default: 0, description: '排序'},
    needAuth2Show: {type: Boolean, default: true, description: '是否需要分配权限才显示'},
    platformType: {type: String, default: 'xxzx', description: '平台类型', enum: PlatformTypeEnum.toValues()},
    toClients: {type: [String], description: '获得本应用授权的其他应用'},
    logoUrl: {type: String, description: '应用图标'},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '插入时间'
    },
    updateTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '最近更新时间'
    },
})

/**
 * @description 索引
 */
clientSchema.index({insertTime: 1})
clientSchema.index({updateTime: 1})
clientSchema.index({clientCode: 1})
clientSchema.index({'operator.userCode': 1})

export default clientSchema