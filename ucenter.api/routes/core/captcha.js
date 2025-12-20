import {getDefaultResponseSchema} from '../../plugins/format-reply.js'
import {generateCaptcha} from '../../services/core/captcha.js'

export const autoPrefix = '/core/captcha'

export default async function (fastify, opts) {
    const checkSchema = {
        description: '生成或刷新验证码',
        summary: '获取验证码',
        querystring: {
            type: 'object',
            properties: {
                captchaKey: {type: 'string', description: '验证码key，刷新验证码时传递，第一次获取会自动生成'}
            }
        },
        tags: ['code'],
        response: {
            default: {
                ...getDefaultResponseSchema({
                    image: {type: 'string', description: 'svg格式的二维码图片'},
                    key: {type: 'string', description: '验证码key'}
                })
            }
        }
    }
    fastify.get('/', {schema: checkSchema}, async function (request, reply) {
        return await generateCaptcha(request.reqParams.captchaKey, request.reqParams.options)
    })
}
