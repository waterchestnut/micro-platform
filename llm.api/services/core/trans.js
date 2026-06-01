/**
 * @fileOverview 大模型翻译相关的业务操作
 * @author xianyang 2025/11/06
 * @module
 */

import {OpenAI} from 'openai'
import retSchema from '../../daos/retSchema.js'

const tools = llm.tools
const logger = llm.logger
const config = llm.config
const llmConfig = config.models.deepseek31

/**
 * @description 检测文本是否为非中文，若是则翻译为简体中文，返回整段翻译和逐句翻译
 * @author xianyang
 * @param {String} sourceText 原文，不能超过8000字
 * @param {Object} options 附加选项
 * @returns {Promise<{fullTrans: string, sentenceTrans: Array<{original: string, translation: string}>}>}
 */
export async function nonChineseTrans(sourceText, options = {}) {
    if (!sourceText) {
        return {fullTrans: '', sentenceTrans: []}
    }

    if (sourceText.length > 8000) {
        throw new Error('文本不能超过8000字')
    }

    const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/
    if (chineseRegex.test(sourceText)) {
        return {fullTrans: '', sentenceTrans: []}
    }

    const openai = new OpenAI({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
    })

    const sysPrompt = `你是一个多语言翻译高手。请将用户提供的非中文原文翻译为简体中文。
你需要返回以下格式的JSON：
{
  "fullTrans": "整段翻译后的文本",
  "sentenceTrans": [
    {"original": "第一句原文", "translation": "第一句译文"},
    {"original": "第二句原文", "translation": "第二句译文"}
  ]
}
要求：
1. 整段翻译（fullTrans）是对整个原文的连贯翻译
2. 逐句翻译（sentenceTrans）是将原文按句子拆分后逐句翻译
3. 仅返回JSON，不要额外解释
4. 如果无法识别或无法翻译，fullTrans为空字符串，sentenceTrans为空数组`

    let ret = await openai.chat.completions.create({
        model: llmConfig.model,
        messages: [
            {'role': 'system', 'content': sysPrompt},
            {'role': 'user', 'content': `**原文：**\n${sourceText}`}
        ],
        max_tokens: llmConfig.maxTokens,
        temperature: 0.7,
        stream: false
    })

    if (!ret?.choices?.length) {
        return {fullTrans: '', sentenceTrans: []}
    }

    try {
        const content = ret.choices[0].message.content
        if (content.startsWith('无法识别与翻译')) {
            return {fullTrans: '', sentenceTrans: []}
        }
        return JSON.parse(content)
    } catch (e) {
        logger.error(e)
        return {fullTrans: '', sentenceTrans: []}
    }
}

/**
 * @description 自动翻译原文信息
 * @author xianyang
 * @param {String} sourceText 原文
 * @param {Object} options 附加选项
 * @returns {Promise<String>} 译文
 */
export async function autoTrans(sourceText, options = {}) {
    if (!sourceText) {
        return ''
    }

    const openai = new OpenAI({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
    })
    let ret = await openai.chat.completions.create(
        {
            model: llmConfig.model,
            messages: [
                {
                    'role': 'system',
                    'content': '你是一个多语言翻译高手，请识别用户提供的原文语言并进行翻译。如果用户提供的原文为中文，则把用户提供的原文翻译为英文；如果用户提供的原文不是中文，则把用户提供的原文翻译为中文。仅返回翻译后的文本，无需<**译文：**>等格式说明。如果无法识别用户提供的原文语言或无法翻译，请回答：无法识别与翻译。'
                },
                {
                    'role': 'user',
                    'content': `**原文：**\n${sourceText}`,
                }
            ],
            max_tokens: llmConfig.maxTokens,
            temperature: 0.7,
            stream: false
        }
    )
    if (!ret?.choices?.length || ret.choices[0].message.content.startsWith('无法识别与翻译')) {
        return ''
    }
    return ret.choices[0].message.content
}

/**
 * @description 自动识别图片中的文字并翻译
 * @author xianyang
 * @param {String} imgUrl 图片链接
 * @param {Object} options 附加选项
 * @returns {Promise<{ocr:string,trans:string}>} 识别的文字与译文
 */
export async function pictureTrans(imgUrl, options = {}) {
    if (!imgUrl) {
        return {
            ocr: '',
            trans: ''
        }
    }

    let llmConfig = config.models.qwenVLPlus
    const openai = new OpenAI({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
    })
    const sysPrompt = `
        ## 定位
        - 角色：OCR+多语言翻译专家
        - 任务：根据用户提供的图片，识别图片中的文本，并把识别的文本进行翻译
        
        ## 输出要求
        - 以JSON的格式返回识别的文本
        - 如果识别的文本为中文，则把识别的文本翻译为英文
        - 如果识别的文本不是中文，则把识别的文本翻译为中文
        - 如果无法识别或无法翻译，请回答：无法识别与翻译。
        - 请严格遵守上述要求
        `
    const examplePromptJson = `
        ## 输出样例（参考输出样例返回JSON格式的数据，无需额外解释）：
        {
          "ocr": "识别的文本",
          "trans": "识别文本的译文"
        }
        `
    let ret = await openai.chat.completions.create(
        {
            model: llmConfig.model,
            messages: [
                {
                    'role': 'system',
                    'content': sysPrompt
                },
                {
                    'role': 'user',
                    'content': examplePromptJson,
                },
                {
                    'role': 'user',
                    'content': [
                        {
                            type: 'image_url',
                            image_url: {url: imgUrl}
                        },
                        {type: 'text', text: 'OCR识别并翻译'},
                    ],
                }
            ],
            max_tokens: llmConfig.maxTokens,
            temperature: 0.7,
            stream: false
        }
    )
    if (!ret?.choices?.length || ret.choices[0].message.content.startsWith('无法识别与翻译')) {
        return {ocr: '未识别', trans: '未识别'}
    }
    try {
        return JSON.parse(ret.choices[0].message.content)
    } catch (e) {
        logger.error(e)
        return {ocr: '未识别', trans: '未识别'}
    }
}