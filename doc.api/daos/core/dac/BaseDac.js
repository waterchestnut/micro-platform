/**
 * @fileOverview 基础数据库操作类
 * @author xianyang 2024/6/8
 * @module
 */

import * as tools from "../../../tools/index.js"
import utils from "../utils.js"

export default class {

    constructor(Model, codeKey) {
        this._Model = Model
        this._codeKey = codeKey
    }

    /**
     * @description 拼接查询参数
     * @author xianyang
     * @param {Object} options 主键
     * @returns {{$and: [Object]}} 查询参数
     */
    assembleParams(options) {
        let params = {$and: []}
        if (!options.includeDeleted) {
            params.$and.push({status: {$ne: -1}})
        }
        if (tools.isArray(options.status)) {
            params.$and.push({status: {$in: options.status}})
        } else if (!tools.isUndefined(options.status)) {
            params.$and.push({status: {$eq: options.status}})
        }
        if (tools.isArray(options[this._codeKey])) {
            params.$and.push({[this._codeKey]: {$in: options[this._codeKey]}})
        } else if (options[this._codeKey] || options[this._codeKey] === 0) {
            params.$and.push({[this._codeKey]: options[this._codeKey]})
        }

        if (tools.isArray(options.complexFilter)) {
            params.$and = params.$and.concat(options.complexFilter)
        } else if (!tools.isUndefined(options.complexFilter)) {
            params.$and.push(options.complexFilter)
        }

        return params
    }

    /**
     * @description 根据主键ID查询记录
     * @author xianyang
     * @param {*} id 主键
     * @returns {Promise<Object>} 记录对象
     */
    async getById(id) {
        let doc = await this._Model.findById(id).lean().exec()
        return doc
    }

    /**
     * @description 根据mongodb中的唯一标识删除记录
     * @author menglb
     * @param {String} id mongodb唯一标识
     * @returns {Promise<Object>} 删除是否成功
     */
    async deleteById(id) {
        let ret = await this._Model.deleteOne({_id: id}).exec()
        return ret
    }

    /**
     * @description 根据标识删除记录
     * @author menglb
     * @param {String} code 标识
     * @returns {Promise<Object>} 删除是否成功
     */
    async deleteByCode(code) {
        let ret = await this._Model.deleteOne({[this._codeKey]: code}).exec()
        return ret
    }

    /**
     * @description 根据mongodb中的唯一标识修改/或者插入记录
     * @author menglb
     * @param {Object} newInfo 记录信息
     * @returns {Promise<Object>} 记录对象
     */
    async updateById(newInfo) {
        let conditions = {_id: newInfo._id}
        let update = utils.getUpdateSets(newInfo)

        let options = {new: true, upsert: true, setDefaultsOnInsert: true}
        return this._Model.findOneAndUpdate(conditions, update, options).exec()
    }

    /**
     * @description 根据标识查询记录
     * @author xianyang
     * @param {String} code 标识
     * @param {Object | String | Array[String]} [projection] 返回字段（默认返回全部）
     * @param {Object} [options] 其他参数，详情请查看：https://mongoosejs.com/docs/api/query.html#query_Query-setOptions
     * @returns {Promise<Object>} 记录对象
     */
    async getByCode(code, projection = null, options = null) {
        let doc = await this._Model.findOne({[this._codeKey]: code}, projection, options).lean().exec()
        return doc
    }

    /**
     * @description 按条件获取一条记录（未设置status时默认排除-1）
     * @param {Object} filter 筛选条件
     * @returns {Promise<Object>} 记录对象
     */
    async getOneByFilter(filter = {}) {
        if (!Object.keys(filter).length) {
            return null
        }
        if (tools.isUndefined(filter.status)) {
            filter.status = {$ne: -1}
        }
        return this._Model.findOne(filter).lean().exec()
    }

    /**
     * @description 分页获取记录
     * @author xianyang
     * @param {Number} pageIndex 页码
     * @param {Number} pageSize 页面大小
     * @param {Object} [options] 其他参数对象
     * @returns {Promise<{total: Number, rows: [Object]}>} 记录列表
     */
    async getByPage(pageIndex, pageSize, options) {
        options = options || {}
        let params = this.assembleParams(options)

        if (!options.sort) {
            options.sort = {insertTime: -1}
        }

        let ret = {total: 0, rows: []}
        /*console.log(JSON.stringify(params))*/
        if (pageSize > 0) {
            let docs = await this._Model.find(params.$and.length ? params : {}).sort(options.sort).skip((pageIndex - 1) * pageSize).limit(pageSize).lean().exec()
            if (!docs || !docs.length) {
                return ret
            }
            ret.rows = docs
        }
        if (options.total) {
            ret.total = options.total
            return ret
        }

        ret.total = params.$and.length ? (await this._Model.countDocuments(params)) : (await this._Model.estimatedDocumentCount())
        return ret
    }

    /**
     * @description 获取前N条记录
     * @author xianyang
     * @param {Number} length 最大条数
     * @param {Object} [options] 其他参数对象
     * @param {Object} [sort] 自定义排序
     * @returns {Promise<Array>} 记录列表
     */
    async getTop(length, options, sort = {updateTime: -1}) {
        options = options || {}
        let params = this.assembleParams(options)

        let docs = await this._Model.find(params.$and.length ? params : {}).sort(sort).limit(length).lean().exec()
        if (!docs || !docs.length) {
            return []
        }

        return docs
    }

    /**
     * @description 根据条件获取记录的数量
     * @author xianyang
     * @param {Object} [options] 其他参数对象
     * @returns {Promise<Number>} 记录的数量
     */
    async getCount(options) {
        options = options || {}
        let params = this.assembleParams(options)

        let count = params.$and.length ? (await this._Model.countDocuments(params)) : (await this._Model.estimatedDocumentCount())
        return count
    }

    /**
     * @description 聚合
     * @param {Object} pipeline aggregate的原始pipeline参数
     * @param {Object} options aggregate的原始options参数
     * @returns {Promise<Array>}
     */
    async aggregate(pipeline, options = {}) {
        let ret = await this._Model.aggregate(pipeline).option(options).exec()
        /*console.log(ret)*/
        return ret
    }

    /**
     * @description 添加记录
     * @author xianyang
     * @param {Object} info 记录
     * @returns {Promise<Object>} 返回添加成功的记录
     */
    async add(info) {
        let record = new this._Model(info)
        let doc = await record.save()
        return doc
    }

    /**
     * 修改单条记录（部分字段更新、不存在时插入）
     * @author xianyang
     * @param {Object} newInfo 要更新的对象
     * @param {Object} [customConditions] 自定义更新条件
     * @return {Promise<Object>} 影响的行数
     */
    async upsert(newInfo, customConditions = null) {
        let conditions = {[this._codeKey]: newInfo[this._codeKey]}
        if (customConditions && Object.keys(customConditions).length) {
            conditions = customConditions
        }
        let update = utils.getUpdateSets(newInfo, true)

        let options = {new: true, upsert: true, setDefaultsOnInsert: true}
        return this._Model.findOneAndUpdate(conditions, update, options).exec()
    }

    /**
     * 修改记录（部分字段更新）
     * @author xianyang
     * @param {Object} newInfo 要更新的对象
     * @param {Object} [filter] 过滤条件，默认：{[this._codeKey]: newInfo[this._codeKey]}
     * @param {Object} [options] 更新扩展选项
     * @param {Boolean} notUpdateTime 是否不更新updateTime字段
     * @return {Promise<Object>} 影响的行数
     */
    async update(newInfo, filter = null, options = {}, notUpdateTime = false) {
        let conditions = filter || {[this._codeKey]: newInfo[this._codeKey]}
        let update = utils.getUpdateSets(newInfo, true, notUpdateTime)

        options = options || {}
        options = Object.assign(options, {upsert: false})
        return this._Model.updateMany(conditions, update, options).exec()
    }

    /**
     * 修改单条记录（整体更新、不存在时插入）
     * @author xianyang
     * @param {Object} newInfo 整体更新的对象
     * @return {Promise<Object>} 影响的行数
     */
    async upsertWhole(newInfo) {
        let conditions = {[this._codeKey]: newInfo[this._codeKey]}

        let options = {upsert: true}
        return this._Model.replaceOne(conditions, newInfo, options).exec()
    }

    /**
     * 批量修改记录
     * @author xianyang
     * @param {Array} newInfos 要更新的对象列表
     * @return {Promise<Object>} BulkWriteOpResult的执行结果
     */
    async bulkUpdateById(newInfos) {
        let commands = []
        newInfos.forEach(newInfo => {
            commands.push({
                updateOne: {
                    filter: {_id: newInfo._id},
                    update: utils.getUpdateSets(newInfo, true),
                    upsert: false
                }
            })
        })

        return this._Model.bulkWrite(commands)
    }

    /**
     * 批量修改记录
     * @author xianyang
     * @param {Array} newInfos 要更新的对象列表
     * @param {Object} [options] 更新参数
     * @param {Object} [options.__options] updateOne的原始参数
     * @param {Boolean} [options.notUpdateTime=false] 是否更新updateTime字段，默认更新为当前时间
     * @param {Boolean} [options.upsert=true] 不存在时是否插入数据
     * @return {Promise<Object>} BulkWriteOpResult的执行结果
     */
    async bulkUpdate(newInfos, options = {}) {
        let commands = []
        newInfos.forEach(info => {
            commands.push({
                updateOne: {
                    ...info.__options,
                    filter: {
                        [this._codeKey]: info[this._codeKey]
                    },
                    update: utils.getUpdateSets(info, true, options.notUpdateTime),
                    upsert: tools.isUndefined(options.upsert) ? true : options.upsert
                }
            })
        })

        return this._Model.bulkWrite(commands)
    }

    /**
     * 根据记录的标识删除记录的部分字段
     * @author xianyang
     * @param {Array[String]} codes 标识列表
     * @param {Array[String]} fields 要删除的字段名称
     * @return {Promise<Object>} 执行结果
     */
    async deleteFieldsByCodes(codes, fields) {
        let update = {$unset: {}}
        fields.forEach(field => {
            update.$unset[field] = 1
        })
        return this._Model.updateMany({[this._codeKey]: {$in: codes}}, update, {multi: true}).exec()
    }

    /**
     * @description 根据条件物理删除操作记录（慎用，以免误删除记录）
     * @author xianyang
     * @param {Object} filter 删除条件
     * @returns {Promise<*>} 受影响的行数
     */
    async destroyByFilter(filter) {
        if (!Object.keys(filter).length) {
            return
        }
        let options = {...filter}
        return this._Model.deleteMany(options)
    }

}