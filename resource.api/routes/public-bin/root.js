import {mergeSearch} from "../../services/search/index.js";

/**
 * @fileOverview 开放接口
 * @module
 */
export const autoPrefix = '/public-bin'
export default async function (fastify, opts) {
    fastify.post('/resource/recommend', {
        schema: {
            description: '推荐资源',
            summary: '推荐资源',
            tags: ['public-bin'],
            response: {}
        }
    }, async function (req, reply) {
        let pageSize = req.reqParams.pageSize || 20;
        if (pageSize > 20) {
            pageSize = 20;
        }
        return await mergeSearch({}, req.reqParams.filter, 1, pageSize, req.reqParams.options, req.reqParams.sort)
    });

    fastify.get('/resource/thesis/detail', {
        schema: {
            description: '获取论文详情',
            summary: '论文详情',
            querystring: {
                type: 'object',
                properties: {
                    resCode: {type: 'string', description: '资源标识'}
                },
            },
            tags: ['public-bin'],
            response: {}
        }
    }, async function (req, reply) {
        let filter = {
            type: ['thesis'],
            resCode: req.query.resCode
        };
        let data = await mergeSearch({}, filter, 1, 1);
        return data?.rows?.length ? data?.rows[0] : null;
    })
}