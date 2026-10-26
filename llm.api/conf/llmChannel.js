/**
 * @fileOverview 大模型对话频道的设置
 * @author xianyang
 * @module
 *
 * 频道可选字段（档位值取 conf/llmModel.js 里的 relay_<族>_<档>）：
 *   model       该频道的文本档
 *   visionModel 该频道带图片输入时的档（必须是视觉族 qwen_vl）
 * 选档优先级：请求的 llmModel > 频道声明（带图只认 visionModel）> 全局默认
 *   （LLM_DEFAULT_CONFIG_KEY / LLM_DEFAULT_VL_CONFIG_KEY）
 * 这样重活（长文献、代码）与轻活（摘要、清洗）按频道分档，调用方不必每处传模型名；
 * 换后端或改真实模型名仍然只动中转站与 .env。
 */
import {relayModels} from './llmModel.js'

const llmChannelDataSet = {
    /** 通用聊天助手 */
    micro_common: {
        /** 文本档：入口频道，MCP/Skills/工具链最重，保持 Pro；要压成本可改 relay_common_flash */
        model: 'relay_common_pro',
        /** 带图档：文档截图、拍照题目等走视觉族 Pro */
        visionModel: 'relay_qwen_vl_pro',
        /** 系统提示词 */
        sysPrompt: `你是一个高校师生教、学助手，请根据用户提供的用户资料回答用户的问题。`,
        /** 增强检索提示词 */
        ragPrompt: `## 用户资料： \n
    {{segs}}`,
        /** 可以调用的MCP配置列表
         * transport 支持: 'sse' | 'streamableHttp' */
        mcpServers: {
            /*searxng: {
                transport: 'sse',
                url: process.env['MCP_SEARXNG_URI']
            },*/
            searxng_http: {
                transport: 'streamableHttp',
                url: process.env['MCP_SEARXNG_HTTP_URI'],
                transportOptions: {
                    sessionId: null,
                    reconnectionOptions: {
                        maxRetries: 2,
                        initialReconnectionDelay: 1000,
                        maxReconnectionDelay: 30000
                    }
                }
            }
        },
        /** 是否启用MCP调用 */
        enableMcp: true,
        /** Agent Skills 配置 */
        skills: {
            /** 是否启用 Skills */
            enabled: true,
            /** 该频道专用的 Skills 列表 */
            skillNames: ['document-extractor'],
            /** 最大匹配 Skills 数量 */
            maxSkills: 4,
            /** 匹配阈值 */
            threshold: 0.3,
            /** 是否启用 Skill 指令自动执行 */
            enableSkillExecution: true,
        },
    },
    /** 文献助手 */
    pdfviewer_literature: {
        /** 文本档：整篇文献 + 检索段落都要吃窗口，用 Pro；只做摘要问答的话可降到 relay_common_flash */
        model: 'relay_common_pro',
        /** 带图档：论文截图、图表解读走视觉族 Pro */
        visionModel: 'relay_qwen_vl_pro',
        /** 系统提示词 */
        sysPrompt: `你是一个文献解读专家，请根据用户提供的文献材料回答用户的问题。`,
        /** 增强检索提示词 */
        ragPrompt: `## 文献材料： \n
    {{segs}}`,
        /** 是否启用MCP调用 */
        enableMcp: false,
        /** Agent Skills 配置 */
        skills: {
            enabled: false,
            skillNames: [],
            maxSkills: 2,
            threshold: 0.3,
            enableSkillExecution: false,
        },
    },
    /** 代码助手 - 启用代码相关 Skills */
    code_assistant: {
        /** 文本档：代码生成/审查走千问 Pro（族内指令遵循与长输出更稳） */
        model: 'relay_qwen_pro',
        /** 带图档：截图报错、UI 稿走视觉族 Pro */
        visionModel: 'relay_qwen_vl_pro',
        /** 系统提示词 */
        sysPrompt: `你是一个专业的代码助手，可以帮助用户编写、审查和优化代码。`,
        /** Agent Skills 配置 */
        skills: {
            enabled: true,
            /** 指定只能使用代码相关的 Skills */
            skillNames: ['code-reviewer', 'refactoring-expert'],
            maxSkills: 2,
            threshold: 0.2,
            enableSkillExecution: true,
        }
    },
}

export default llmChannelDataSet

/**
 * @description 获取所有已配置的频道列表
 * @returns {string[]} 频道名称数组
 */
export function getConfiguredChannels() {
    return Object.keys(llmChannelDataSet)
}

/**
 * @description 校验频道是否存在于配置中
 * @param {string[]} channels 频道列表
 * @returns {string[]} 无效频道列表
 */
export function validateChannels(channels) {
    const configuredChannels = getConfiguredChannels()
    return channels.filter(channel => !configuredChannels.includes(channel))
}

/** 频道未配置 memory 段时的默认值：全关（memory-plan D2） */
const DEFAULT_MEMORY = {
    enabled: false,
    /** 是否采集原始事件 */
    capture: false,
    /** 是否注入召回结果 */
    recall: false,
    /** 召回 token 预算，缺省回落 config.memory.recall.tokens */
    recallTokens: undefined,
}

/**
 * @description 校验各频道声明的档位是否有效（model 必须存在，声明了 visionModel 必须是视觉族）
 * @returns {String[]} 问题描述列表，空数组即配置无误
 */
export function validateChannelModels() {
    const problems = []
    for (const [channel, cfg] of Object.entries(llmChannelDataSet)) {
        for (const [field, key] of [['model', cfg.model], ['visionModel', cfg.visionModel]]) {
            if (!key) {
                continue
            }
            const model = relayModels[key]
            if (!model) {
                problems.push(`${channel}.${field}=${key} 不是有效档位（见 conf/llmModel.js）`)
            } else if (field === 'visionModel' && !model.vision) {
                problems.push(`${channel}.${field}=${key} 不是视觉族，带图请求会被拒`)
            }
        }
    }
    return problems
}

/**
 * @description 取频道生效的记忆配置（频道未配置时返回默认关闭）
 * @param {String} channel 频道标识
 * @returns {Object} 合并默认后的频道记忆配置
 */
export function getChannelMemory(channel) {
    const channelConfig = llmChannelDataSet[channel] || {}
    return {...DEFAULT_MEMORY, ...(channelConfig.memory || {})}
}