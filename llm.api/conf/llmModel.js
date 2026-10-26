/**
 * @fileOverview 大模型分级配置：走中转站（一个 base + 一个 key），后端模型按「族 × 档」抽象
 * @module conf/llmModel
 *
 * 命名规则：`relay_<family>_<tier>`
 *   family（族，决定 tokenizer 与是否吃图）：common 通用 | qwen 千问系 | deepseek | qwen_vl 视觉
 *   tier（档，决定窗口/输出上限与用途）    ：pro 复杂 | flash 常规 | low 批量/后台
 *
 * 使用侧（前端 options.llmModel、agentTask.params.llmModel）只传这个 key，
 * 换后端供应商/换真实模型名属于中转站的渠道配置，本服务不再为每家单独配 URI+KEY+MODEL。
 *
 * 每项都可被同名环境变量覆盖（键 = `<模型key>_<字段>`，字段同下），例如：
 *   relay_qwen_pro_model=qwen3-max
 *   relay_common_low_baseURL=http://other-relay:3009/v1
 * 全局默认来自中转站两件套：`LLM_RELAY_BASE_URL` / `LLM_RELAY_API_KEY`。
 */
import dotenv from 'dotenv'

dotenv.config()

/** 档位默认值：窗口与输出上限（估算用途，务必满足 contextWindow > maxTokens） */
export const modelTiers = {
    /** 复杂任务：长上下文、代码、推理链 */
    pro: {contextWindow: 131072, maxTokens: 60000},
    /** 常规任务：日常问答、抽取、翻译 */
    flash: {contextWindow: 65536, maxTokens: 32768},
    /** 批量/后台任务：记忆抽取、摘要、清洗，追求便宜快 */
    low: {contextWindow: 32768, maxTokens: 16384},
}

/**
 * 族默认值：tokenizer 为 tiktoken 编码名，实际后端模型未必完全吻合，这里只做保守估算；
 * imageTokens 为一张图折算的 token 数（预算裁剪用）
 */
export const modelFamilies = {
    common: {tokenizer: 'o200k_base', label: '通用'},
    qwen: {tokenizer: 'cl100k_base', label: '千问'},
    deepseek: {tokenizer: 'cl100k_base', label: 'DeepSeek'},
    qwen_vl: {tokenizer: 'cl100k_base', imageTokens: 1024, label: '视觉', vision: true},
}

/** 中转站地址与密钥（所有 relay_* 的默认值） */
const relayBaseURL = process.env['LLM_RELAY_BASE_URL'] || 'http://127.0.0.1:3009/v1'
const relayApiKey = process.env['LLM_RELAY_API_KEY'] || ''

/**
 * @description 按「族 × 档」生成一个模型配置节点
 * @param {String} key 模型 key（同时作为环境变量前缀），如 relay_qwen_pro
 * @param {String} model 中转站侧的真实模型名
 * @param {String} tier 档位：pro | flash | low
 * @param {String} family 族：common | qwen | deepseek | qwen_vl
 * @returns {Object} 模型配置
 */
function relayModel(key, model, tier, family) {
    const t = modelTiers[tier] || modelTiers.pro
    const f = modelFamilies[family] || modelFamilies.common
    return {
        /** 该节点的 key（供日志/记录用，与 config.models 的键一致） */
        key,
        /** 档位与族（前端可据此分组展示） */
        tier,
        family,
        label: `${f.label}·${tier === 'pro' ? 'Pro' : tier === 'flash' ? 'Flash' : 'Low'}`,
        /** 族显示名 */
        familyLabel: f.label,
        /** openai 兼容接口基地址 */
        baseURL: process.env[`${key}_baseURL`] || relayBaseURL,
        /** openai 兼容接口 key */
        apiKey: process.env[`${key}_apiKey`] || relayApiKey,
        /** 中转站真实模型名 */
        model: process.env[`${key}_model`] || model,
        /** 单次响应输出上限 */
        maxTokens: parseInt(process.env[`${key}_maxTokens`] || t.maxTokens),
        /** 采样温度 */
        temperature: parseFloat(process.env[`${key}_temperature`] || 0.7),
        /** 是否默认流式 */
        stream: process.env[`${key}_stream`] === 'true',
        /** 上下文窗口（预算 = contextWindow - maxTokens - slackTokens） */
        contextWindow: parseInt(process.env[`${key}_contextWindow`] || t.contextWindow),
        /** token 估算用的编码名 */
        tokenizer: process.env[`${key}_tokenizer`] || f.tokenizer,
        /** 一张图折算的 token 数 */
        imageTokens: parseInt(process.env[`${key}_imageTokens`] || f.imageTokens || 765),
        /** 是否视觉模型（可带图片输入） */
        vision: Boolean(f.vision),
        /**
         * 思考模式的私有参数（各家字段不同，中转站不会代转）：不配即不下发。
         * 例：relay_qwen_pro_enableThinking={"enable_thinking":true}
         *     relay_deepseek_pro_enableThinking={"thinking":{"type":"enabled"}}
         */
        enableThinking: process.env[`${key}_enableThinking`]
            ? JSON.parse(process.env[`${key}_enableThinking`])
            : undefined,
    }
}

/** 全部中转站模型（族 × 档） */
export const relayModels = {
    /** 中转站·通用 Pro */
    relay_common_pro: relayModel('relay_common_pro', 'common-pro', 'pro', 'common'),
    /** 中转站·通用 Flash */
    relay_common_flash: relayModel('relay_common_flash', 'common-flash', 'flash', 'common'),
    /** 中转站·通用 Low */
    relay_common_low: relayModel('relay_common_low', 'common-low', 'low', 'common'),
    /** 中转站·千问 Pro */
    relay_qwen_pro: relayModel('relay_qwen_pro', 'qwen-pro', 'pro', 'qwen'),
    /** 中转站·千问 Flash */
    relay_qwen_flash: relayModel('relay_qwen_flash', 'qwen-flash', 'flash', 'qwen'),
    /** 中转站·千问 Low */
    relay_qwen_low: relayModel('relay_qwen_low', 'qwen-low', 'low', 'qwen'),
    /** 中转站·DeepSeek Pro */
    relay_deepseek_pro: relayModel('relay_deepseek_pro', 'deepseek-pro', 'pro', 'deepseek'),
    /** 中转站·DeepSeek Flash */
    relay_deepseek_flash: relayModel('relay_deepseek_flash', 'deepseek-flash', 'flash', 'deepseek'),
    /** 中转站·DeepSeek Low */
    relay_deepseek_low: relayModel('relay_deepseek_low', 'deepseek-low', 'low', 'deepseek'),
    /** 中转站·视觉 Pro（默认视觉模型） */
    relay_qwen_vl_pro: relayModel('relay_qwen_vl_pro', 'qwen-vl-pro', 'pro', 'qwen_vl'),
    /** 中转站·视觉 Flash */
    relay_qwen_vl_flash: relayModel('relay_qwen_vl_flash', 'qwen-vl-flash', 'flash', 'qwen_vl'),
    /** 中转站·视觉 Low */
    relay_qwen_vl_low: relayModel('relay_qwen_vl_low', 'qwen-vl-low', 'low', 'qwen_vl'),
}

/**
 * 历史模型名 → 中转站档位。老数据（conversation/message/answerCache 里的 llmModel）
 * 与还没改调用参数的外部调用方仍可用，读取时自动落到对应档位。
 */
export const legacyModelAliases = {
    /** 本地通义千问3 */
    qwen3xin: 'relay_qwen_flash',
    /** 豆包 1.6 */
    doubao16: 'relay_common_flash',
    /** DeepSeek V3.1 */
    deepseek31: 'relay_deepseek_pro',
    /** Kimi K2 */
    kimik2: 'relay_common_pro',
    /** 百炼·通义千问 Plus */
    qwenPlus: 'relay_qwen_pro',
    /** 百炼·通义千问 VL Plus */
    qwenVLPlus: 'relay_qwen_vl_pro',
    /** 腾讯云·混元 Large */
    hunyuanLarge: 'relay_common_pro',
}

/** 默认档位：文本聊天 / 带图聊天 */
export const defaultModelKey = process.env['LLM_DEFAULT_CONFIG_KEY'] || 'relay_common_pro'
export const defaultVisionModelKey = process.env['LLM_DEFAULT_VL_CONFIG_KEY'] || 'relay_qwen_vl_pro'

/** 中转站模型 key 列表（不含历史别名，给 UI/文档分组用） */
export function listModelKeys() {
    return Object.keys(relayModels)
}

/**
 * @description 按族分组的模型清单（前端下拉/文档展示）
 * @returns {Array<{family:String,label:String,vision:Boolean,models:Array>}> 分组结果
 */
export function listModelGroups() {
    const groups = []
    for (const [key, m] of Object.entries(relayModels)) {
        let g = groups.find(x => x.family === m.family)
        if (!g) {
            g = {family: m.family, label: m.familyLabel, vision: m.vision, models: []}
            groups.push(g)
        }
        g.models.push({key, tier: m.tier, label: m.label, contextWindow: m.contextWindow, maxTokens: m.maxTokens})
    }
    return groups
}

/**
 * @description 归一化模型 key（历史别名落到对应档位，非法/缺省回落默认档）
 * @param {String} [key] 请求传入的 llmModel
 * @param {String} [fallbackKey] 本次调用的默认 key（如带图时用视觉档）
 * @returns {String} config.models 里真实存在的 key
 */
export function resolveModelKey(key, fallbackKey = defaultModelKey) {
    const wanted = key || fallbackKey
    return legacyModelAliases[wanted] || (relayModels[wanted] ? wanted : fallbackKey)
}

/**
 * @description 取模型配置节点（带别名解析与默认回落）
 * @param {String} [key] 请求传入的 llmModel
 * @param {String} [fallbackKey] 默认 key
 * @returns {Object} 模型配置
 */
export function getModelConfig(key, fallbackKey = defaultModelKey) {
    return relayModels[resolveModelKey(key, fallbackKey)]
}

/**
 * @description 按「请求 > 频道声明 > 全局默认」选定本次档位
 * @author xianyang
 * @param {Object} params 选择参数
 * @param {String} [params.llmModel] 请求显式指定的模型名（历史供应商名会自动归一到档位）
 * @param {Object} [params.channelConfig] 频道配置项（conf/llmChannel.js 的一个频道，可声明 model / visionModel）
 * @param {Boolean} [params.hasInputs] 本次是否带多模态输入（图片等）
 * @returns {String} 一定存在于 relayModels 的档位 key
 * @description 带图时绝不采用频道声明的文本档（否则图片会被喂给不支持视觉的模型），
 * 只认频道单独的 visionModel 或请求显式指定的档位；声明的档位拼错时回落全局默认，
 * 由 test/conf/llmChannelModels.test.js 在 CI 里拦住。
 */
export function pickModelKey({llmModel, channelConfig = {}, hasInputs = false} = {}) {
    const declared = hasInputs ? channelConfig.visionModel : channelConfig.model
    const fallback = hasInputs ? defaultVisionModelKey : defaultModelKey
    return resolveModelKey(llmModel || declared, fallback)
}
