import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {generateImage} from '../../../services/core/imageGeneration.js'

export const autoPrefix = '/core/image'

export default async function (fastify, opts) {

    fastify.post('/generation', {
        schema: {
            description: '文生图：按提示词生成一张图（base64 返回，不落会话；档位缺省常规档，可选复杂/批量档）。'
                + '上游为中转站图像端点，计费或渠道未配置时以带原因的失败返回，不静默降级。',
            summary: '文生图',
            body: {
                type: 'object',
                required: ['prompt'],
                properties: {
                    prompt: {type: 'string', description: '提示词（≤4000 字符）'},
                    size: {type: 'string', description: '尺寸，白名单如 1024x1024 / 1024x1536 / 768x1024'},
                    llmModel: {type: 'string', description: '档位：relay_image_pro | relay_image_flash | relay_image_low'},
                },
            },
            tags: ['image'],
            response: {
                default: getDefaultResponseSchema({
                    b64: {type: 'string'}, revisedPrompt: {type: 'string'}, model: {type: 'string'}, size: {type: 'string'},
                }),
            },
        },
    }, async function (request, reply) {
        const {prompt, size, llmModel} = request.body || {}
        const ret = await generateImage({prompt, size, llmModel}, {trace: request.trace})
        return ret
    })
}
