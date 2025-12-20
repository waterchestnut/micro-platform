import {getDefaultResponseSchema} from '../../../plugins/format-reply.js'
import {autoTrans, pictureTrans} from '../../../services/core/trans.js'

export default async function (fastify, opts) {

    fastify.post('/llm/auto', {
        schema: {
            description: '调用大模型自动检测语言并翻译原文',
            summary: '大模型文本翻译',
            body: {
                type: 'object',
                properties: {
                    sourceText: {type: 'string', description: '原文'},
                    options: {
                        type: 'object',
                        properties: {
                            sourceLanguage: {type: 'string', description: '原文语言'},
                            targetLanguage: {type: 'string', description: '目标语言'},
                        }
                    }
                }
            },
            tags: ['trans'],
            response: {
                default: {...getDefaultResponseSchema({transText: {type: 'string', description: '译文'}})}
            }
        },
    }, async function (request, reply) {
        let ret = await autoTrans(request.reqParams.sourceText, request.reqParams.options)
        return {transText: ret}
    })

    fastify.post('/llm/picture', {
        schema: {
            description: '调用大模型自动识别图片中的文本并翻译',
            summary: '大模型图片翻译',
            body: {
                type: 'object',
                properties: {
                    imgUrl: {type: 'string', description: '图片链接'},
                    options: {
                        type: 'object',
                        properties: {
                            sourceLanguage: {type: 'string', description: '原文语言'},
                            targetLanguage: {type: 'string', description: '目标语言'},
                        }
                    }
                }
            },
            tags: ['trans'],
            response: {
                default: {
                    ...getDefaultResponseSchema({
                        ocr: {type: 'string', description: '识别的文本'},
                        trans: {type: 'string', description: '译文'}
                    })
                }
            }
        },
    }, async function (request, reply) {
        return await pictureTrans(request.reqParams.imgUrl, request.reqParams.options)
    })
}
