/**
 * @fileOverview 资源搜索gRPC服务端实现
 * @module
 */

import '../../init.js'
import grpc from '@grpc/grpc-js'
import {loadProto} from '../utils.js'
import resourceSearch from '../../services/search/resource/index.js'

// 加载proto文件
const protoPath = resource.baseDir + 'grpc/protos/resourceSearch.proto'
const resourceProto = loadProto(protoPath).resource

/**
 * 初始化资源搜索gRPC服务
 * @param {grpc.Server} server gRPC服务器实例
 */
export function initService(server) {
    // 添加服务实现
    server.addService(resourceProto.ResourceSearchService.service, {
        // 实现SearchAll方法
        SearchAll: async (call, callback) => {
            try {
                const request = call.request
                
                // 转换请求参数格式
                const paramList = request.paramList.map(param => ({
                    query: param.query.map(q => ({
                        q: q.q,
                        key: q.key,
                        method: q.method
                    }))
                }))
                
                const pageIndex = request.pageIndex || 1
                const pageSize = request.pageSize || 20
                const options = {
                    hiddeHighlight: request.options?.hiddeHighlight ?? true
                }

                // 调用现有的search方法
                const result = await resourceSearch.search(
                    paramList,
                    null, // sort参数
                    pageIndex,
                    pageSize,
                    options
                )

                // 构建响应
                const response = {
                    data: {
                        total: result.total,
                        rows: result.rows.map(item => ({
                            resCode: item.resCode || '',
                            abstract: item.abstract || '',
                            url: item.url || '',
                            category: item.category || '',
                            status: item.status || 0,
                            title: item.title || '',
                            resType: item.resType || '',
                            publishDateStr: item.publishDateStr || '',
                            keywords: item.keywords || '',
                            language: item.language || '',
                            source_keys: item.source_keys || [],
                            journalTitle: item.journalTitle || '',
                            publishDate: item.publishDate || '',
                            issues: item.issues || '',
                            sources: item.sources ? item.sources.map(source => ({
                                sourceKey: source.sourceKey || '',
                                href: source.href || '',
                                title: source.title || '',
                                description: source.description || ''
                            })) : [],
                            publisher: item.publisher || '',
                            coverUrl: item.coverUrl || '',
                            author: item.author || ''
                        }))
                    },
                    statusCode: 200,
                    code: 0
                }

                callback(null, response)
            } catch (error) {
                resource.logger.error('ResourceSearch SearchAll error:', error)
                callback({
                    code: grpc.status.INTERNAL,
                    message: error.message || 'Internal server error'
                })
            }
        }
    })
}
