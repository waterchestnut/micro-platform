/**
 * @fileOverview 操作mongodb库中的pageConfig
 * @author xianyang
 * @module
 */

import {PageConfig} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'
import utils from '../utils.js'

export class PageConfigDac extends BaseDac {
    constructor(Model) {
        super(Model, 'pageConfigCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (tools.isArray(options.clientCode)) {
            params.$and.push({clientCode: {$in: options.clientCode}})
        } else if (options.clientCode) {
            params.$and.push({clientCode: options.clientCode})
        }
        if (tools.isArray(options.method)) {
            params.$and.push({method: {$in: options.method}})
        } else if (options.method) {
            params.$and.push({method: options.method})
        }
        if (tools.isExist(options.priv)) {
            params.$and.push({privs: options.priv})
        }
        if (tools.isExist(options.clientPriv)) {
            params.$and.push({clientPrivs: options.clientPriv})
        }
        if (tools.isExist(options.name)) {
            params.$and.push({name: {$regex: new RegExpExt(options.name, 'i', true)}})
        }
        if (tools.isExist(options.path)) {
            params.$and.push({path: {$regex: new RegExpExt(options.path, 'i', true)}})
        }
        return params
    }

    /**
     * @description 查询所有的页面配置信息
     * @author menglb
     * @returns {Promise<Array>} 页面配置信息列表
     */
    async findAllPageConfig() {
        let docs = await PageConfig.find().lean()
        return docs
    }

    /**
     * 清除所有的页面配置信息
     * @author menglb
     * @return {Promise<Object>} {deletedCount: x}
     */
    async clearAllPageConfig() {
        return PageConfig.deleteMany({})
    }

    /**
     * 按照path批量修改配置
     * @author xianyang
     * @param {Array} newInfos 要更新的配置列表
     * @return {Promise<Object>} BulkWriteOpResult的执行结果
     */
    async bulkUpdateByPath(newInfos) {
        let commands = []
        newInfos.forEach(info => {
            commands.push({
                updateOne: {
                    filter: {
                        path: info.path,
                        clientCode: info.clientCode
                    },
                    update: utils.getUpdateSets(info, true),
                    upsert: true
                }
            })
        })

        return this._Model.bulkWrite(commands)
    }
}

export default new PageConfigDac(PageConfig)