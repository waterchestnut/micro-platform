import * as mobileRangeService from '../../../services/core/mobileRange.js'
import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import * as userInfoService from "../../../services/core/userInfo.js";

export default async function (fastify, opts) {
    const checkSchema = {
        description: '检查手机号或固定电话的归属城市',
        summary: '检查手机号归属地',
        querystring: {
            type: 'object',
            properties: {
                phone: {type: 'string'}
            },
            required: ['phone']
        },
        tags: ['public-bin'],
        response: {
            default: getDefaultResponseSchema({
                provName: {type: 'string'},
                cityName: {type: 'string'}
            })
        }
    }
    fastify.get('/check', {schema: checkSchema}, async function (request, reply) {
        let ret = await mobileRangeService.checkBelonging(request.reqParams.phone)
        return ret
    })


    fastify.post('/user/by/info', {
        schema: {
            description: '通过手机号、邮箱或姓名获取用户信息',
            summary: '获取用户信息信息',
            body: {
                type: 'object',
                properties: {
                    info: {type: 'string'}
                },
                required: ["info"]
            },
            tags: [],
            response: {
                default: {
                }
            }
        }
    }, async function (request, reply) {
        let {info} = request.body
        return await userInfoService.getUserByInfo(info)
    })




}
