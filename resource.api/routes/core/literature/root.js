/**
 * @fileOverview 文献阅读相关的接口
 * @author xianyang
 * @module
 */

import {checkLiterature, localFileLiterature, removeLiterature} from '../../../services/core/literature.js'

export const autoPrefix = '/core/literature'

const fileInfoSchema = {$ref: 'fullDefinitionModels#/properties/FileInfo'}

export default async function (fastify, opts) {

    fastify.post('/check', {
        schema: {
            description: '核查资源文献阅读的准备情况，资源是否复制到当前用户名下，资源的RAG是否完成等。',
            summary: '核查资源文献阅读的准备状态',
            body: {
                type: 'object',
                properties: {
                    resCode: {
                        type: 'string',
                        description: '资源标识'
                    },
                },
                required: ['resCode']
            },
            tags: ['literature'],
            response: {}
        }
    }, async function (request, reply) {
        return await checkLiterature(request.userInfo, request.reqParams.resCode)
    })

    fastify.post('/local-file', {
        schema: {
            description: '本地文件上传后进行文献解读',
            summary: '本地文件解读',
            body: fileInfoSchema,
            tags: ['literature'],
            response: {}
        }
    }, async function (request, reply) {
        return await localFileLiterature(request.userInfo, request.reqParams.fileInfo)
    })

    fastify.post('/remove', {
        schema: {
            description: '删除文献解读历史记录',
            summary: '删除文献解读历史记录',
            body: {
                type: 'object',
                properties: {
                    resCode: {
                        type: 'string',
                        description: '资源标识'
                    },
                },
                required: ['resCode']
            },
            tags: ['literature'],
            response: {}
        }
    }, async function (request, reply) {
        return await removeLiterature(request.userInfo, request.reqParams.resCode)
    })
}
