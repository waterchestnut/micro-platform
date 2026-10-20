/**
 * @fileOverview 操作mongodb库中的memoryAtom
 * @module daos/core/dac/memoryAtomDac
 */

import {MemoryAtom} from '../schema/index.js'
import BaseDac from './BaseDac.js'
import * as tools from '../../../tools/index.js'

export class MemoryAtomDac extends BaseDac {
    constructor(Model) {
        super(Model, 'atomCode')
    }

    assembleParams(options) {
        let params = super.assembleParams(options)
        if (options.atomCode) {
            params.$and.push({atomCode: {$eq: options.atomCode}})
        }
        if (tools.isArray(options.atomCodes)) {
            params.$and.push({atomCode: {$in: options.atomCodes}})
        }
        if (options.userCode) {
            params.$and.push({userCode: {$eq: options.userCode}})
        }
        if (options.channel) {
            params.$and.push({channel: {$eq: options.channel}})
        }
        if ('workspaceId' in options) {
            params.$and.push({workspaceId: options.workspaceId || null})
        }
        if (options.kind) {
            params.$and.push({kind: {$eq: options.kind}})
        }
        if (tools.isArray(options.kinds)) {
            params.$and.push({kind: {$in: options.kinds}})
        }
        if (options.topic) {
            params.$and.push({
                $or: [
                    {topic: options.topic},
                    {topics: options.topic},
                ]
            })
        }
        if (options.entityCode) {
            params.$and.push({'entities.entityCode': options.entityCode})
        }
        if (tools.isArray(options.states)) {
            params.$and.push({state: {$in: options.states}})
        } else if (options.state) {
            params.$and.push({state: {$eq: options.state}})
        }
        if (tools.isExist(options.minConfidence)) {
            params.$and.push({confidence: {$gte: options.minConfidence}})
        }
        if (options.content) {
            params.$and.push({content: {$regex: new RegExpExt(options.content, 'i', true)}})
        }
        /** 压实任务找"还没进向量索引"的原子：{$eq: null} 同时覆盖缺字段与显式 null */
        if (options.noIndexedAt) {
            params.$and.push({indexedAt: {$eq: null}})
        }
        return params
    }
}

export default new MemoryAtomDac(MemoryAtom)
