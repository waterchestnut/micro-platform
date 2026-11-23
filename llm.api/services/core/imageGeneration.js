/**
 * @fileOverview 文生图（images/generations 中转）：一次请求一张图，base64 返回，不落会话档案
 * @module services/core/imageGeneration
 *
 * 口径：
 * - 模型走 relay image 族（conf/llmModel.modelFamilies.image），档位缺省 flash，可请求指定；
 * - size 白名单透传（上游 relay 对尺寸有像素/比例硬界，非法值由上游报错原样转达，本层不猜）；
 * - 同步非流式：图片生成本质一发一收，无 conversation/message 落档（图字节不落本库，
 *   消费方拿到 b64 后自行入库 doc 层）；
 * - 上游错误语义透传：400 带 code（如 relay 计费未配 model_price_error）时把 code/message
 *   放进响应 msg 前段，运维在调用方就能定位到"是中转站配置"还是"是参数"。
 */
import {OpenAI} from 'openai'
import {traceHeaders} from '../../tools/traceContext.js'

const SIZES = ['1024x1024', '1024x1536', '1536x1024', '512x512', '768x768', '1024x768', '768x1024']
const MAX_PROMPT = 4000

/**
 * @description 生成图片
 * @param {Object} params 参数
 * @param {String} params.prompt 提示词（≤4000 字符）
 * @param {String} [params.size] 尺寸（白名单内）
 * @param {String} [params.llmModel] image 族档位 key（relay_image_pro/flash/low）
 * @param {Object} context 请求上下文
 * @returns {Object} 信封 {code,msg,data:{b64, revisedPrompt, model, size}}
 */
export async function generateImage({prompt, size, llmModel}, context) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
        return {code: 4001, msg: '缺少提示词', statusCode: 200}
    }
    if (prompt.length > MAX_PROMPT) {
        return {code: 4001, msg: `提示词过长（上限 ${MAX_PROMPT} 字符）`, statusCode: 200}
    }
    if (size && !SIZES.includes(size)) {
        return {code: 4001, msg: `尺寸不在支持列表：${size}`, statusCode: 200}
    }
    const modelKey = ['relay_image_pro', 'relay_image_flash', 'relay_image_low'].includes(llmModel) ? llmModel : 'relay_image_flash'
    const cfg = llm.config.models?.[modelKey]
    if (!cfg?.baseURL || !cfg?.apiKey) {
        return {code: 4001, msg: '文生图服务未配置', statusCode: 200}
    }
    const client = new OpenAI({apiKey: cfg.apiKey, baseURL: cfg.baseURL, defaultHeaders: traceHeaders(context?.trace)})
    try {
        const r = await client.images.generate({
            model: cfg.model,
            prompt: prompt.trim(),
            n: 1,
            ...(size ? {size} : {}),
            response_format: 'b64_json',
        })
        const item = r?.data?.[0] || {}
        if (!item.b64_json) {
            return {code: 4001, msg: '生成结果为空，请重试', statusCode: 200}
        }
        return {
            code: 0, msg: 'ok', statusCode: 200,
            data: {b64: item.b64_json, revisedPrompt: item.revised_prompt || '', model: cfg.model, size: size || 'auto'},
        }
    } catch (e) {
        const code = e?.error?.code || ''
        const upstreamMsg = String(e?.error?.message || e?.message || '生成失败').slice(0, 200)
        llm.logger.warn(`文生图上游失败 model=${cfg.model} code=${code} msg=${upstreamMsg}`)
        /** relay 计费/渠道配置类错误与参数类分开码，且透传上游 code 便于运维定位是中转站配置还是调用参数 */
        const bizCode = code === 'model_price_error' ? 4002 : 4001
        return {code: bizCode, msg: code ? `${code}: ${upstreamMsg}` : upstreamMsg, statusCode: 200}
    }
}
