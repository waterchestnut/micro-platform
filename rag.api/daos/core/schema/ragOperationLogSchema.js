/**
 * @fileOverview 知识库操作日志的结构
 * @module
 */

import mongoose from 'mongoose'
import Operator from '../definition/Operator.js'
import LogTypeEnum from '../enum/LogTypeEnum.js'

const Schema = mongoose.Schema
const tools = rag.tools

/**
 * @description 定义操作日志的结构
 * @property {String} logCode 日志标识
 * @property {String} ragCode 知识库标识
 * @property {String} logType 操作类型，参见LogTypeEnum
 * @property {Schema.Types.Mixed} operator 操作人，参见Operator
 * @property {Schema.Types.Mixed} targetUser 目标用户（成员相关操作时），参见Operator
 * @property {String} targetMaterialTitle 目标材料标题（材料相关操作时）
 * @property {String} targetMaterialCode 目标材料标识（材料相关操作时）
 * @property {String} description 操作描述
 * @property {Schema.Types.Mixed} detail 操作详情（如角色变化前后的值）
 * @property {Date} insertTime 操作时间
 */
const ragOperationLogSchema = new Schema({
    logCode: {
        type: String,
        default: function () {
            return tools.getUUID()
        },
        description: '日志标识',
        required: true
    },
    ragCode: {type: String, description: '知识库标识', required: true},
    logType: {
        type: String,
        description: '操作类型',
        required: true,
        enum: LogTypeEnum.toValues()
    },
    operator: {type: Operator, description: '操作人'},
    targetUser: {type: Operator, description: '目标用户'},
    targetMaterialTitle: {type: String, description: '目标材料标题'},
    targetMaterialCode: {type: String, description: '目标材料标识'},
    description: {type: String, description: '操作描述'},
    detail: {type: Object, description: '操作详情'},
    insertTime: {
        type: Date, default: function () {
            return new Date()
        },
        description: '操作时间'
    },
})

ragOperationLogSchema.index({ragCode: 1, insertTime: -1})
ragOperationLogSchema.index({insertTime: -1})

export default ragOperationLogSchema
