/**
 * @fileOverview mongoose的schema转化为swagger的schema
 * @author xianyang 2024/5/9
 * @module
 */

import mongoose from 'mongoose'
import m2s from 'mongoose-to-swagger-2'
import * as models from '../core/schema/index.js'
import fs from 'fs'
import ragMaterialSchema from '../core/schema/ragMaterialSchema.js'

const baseDir = rag.baseDir

export function convertToSwaggerSchema(mongooseSchema, options = {}) {
    return {
        type: 'object',
        ...m2s(mongooseSchema, {
            props: ['title'],
            omitFields: ['_id', 'insertTime', 'updateTime', 'pwd', '__v', '__options'],
            omitMongooseInternals: true,
            ...options
        })
    }
}

export const getAllStoreModels = (options = {}) => {
    let ret = {}
    for (let key in models) {
        ret[key] = convertToSwaggerSchema(models[key], {omitFields: [], ...options})
    }

    return ret
}

export const getAllParamModels = (options = {}) => {
    let ret = {}
    for (let key in models) {
        ret[key] = convertToSwaggerSchema(models[key], options)
    }

    ret.RagSearchItem = {
        type: 'object',
        title: 'RagSearchItem',
        description: '知识库召回片段的详情',
        properties: {
            ragCode: {type: 'string', nullable: true, description: '知识库标识'},
            ragMaterialCode: {type: 'string', nullable: true, description: '材料标识'},
            ragSegmentCode: {type: 'string', nullable: true, description: '片段标识'},
            content: {type: 'string', description: '片段文本'},
            position: {type: 'number', nullable: true, description: '分段位置序号'},
            wordCount: {type: 'number', nullable: true, description: '分段的字符数量'},
            tokens: {type: 'number', nullable: true, description: '分段的tokens数量'},
            language: {type: 'string', nullable: true, description: '材料的语言'},
            resCode: {type: 'string', nullable: true, description: '材料原文标识'},
            resTitle: {type: 'string', nullable: true, description: '材料原文标题'},
            resOriginalUrl: {type: 'string', nullable: true, description: '材料原文访问地址'},
            chunks: {
                type: 'array',
                items: {
                    ...ret.RagChunk,
                    properties: {
                        ...ret.RagChunk.properties,
                        score: {type: 'number', nullable: true, description: '命中时的分数'}
                    }
                },
                nullable: true,
                required: []
            },
        }
    }

    ret.RagSegment = {
        ...ret.RagSegment,
        properties: {
            ...ret.RagSegment.properties,
            chunks: {
                type: 'array',
                items: {...ret.RagChunk}
            }
        },
        required: ['content']
    }

    ret.RagInfo = {
        ...ret.RagInfo,
        required: ['title']
    }

    ret.RagMaterial = {
        ...ret.RagMaterial,
        required: ['resTitle']
    }

    ret.RagChunk = {
        ...ret.RagChunk,
        required: ['content']
    }

    return ret
}

export const getAllDefinitionModels = async (options = {}) => {
    let ret = {}
    let path = baseDir + 'daos/core/definition'
    let files = fs.readdirSync(path)
    for (let file of files) {
        if (~file.indexOf('.js')) {
            let fileName = file.substring(0, file.indexOf('.js'))
            let Model = await import('../core/definition/' + fileName + '.js')
            /*console.log(Model.default)*/
            ret[fileName] = convertToSwaggerSchema(mongoose.model(fileName, Model.default), options)
        }
    }
    return ret
}