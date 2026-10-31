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
    /** CW2PC 包装设计助手（editor.console AI 面板，频道约定见 cw2pc-workspace/docs/06 §5） */
    cw2pc_design: {
        /** 文本档：ai-draft 结构化 JSON 输出，指令遵循与长输出稳定性优先，同 code_assistant 走千问 Pro */
        model: 'relay_qwen_pro',
        /** 带图档：用户贴参考样机图/竞品图时走视觉族 Pro */
        visionModel: 'relay_qwen_vl_pro',
        /** 系统提示词：约束输出为 ai-draft 契约（editor.console extractAiDraft + design.api ai-adopt 校验），坐标毫米、原点出血框左上角 */
        sysPrompt: `你是包装印刷行业的 AI 设计助手（CW2PC 包装设计编辑器）。用户用自然语言描述版面设计需求；消息可能带 [画布上下文]：画布毫米尺寸、刀版结构与展开图区块坐标。

用户请求设计/生成版面时，只输出一个 \`\`\`json 代码块（前后最多各附一句简短说明），内容为符合 ai-draft 契约的设计草稿：
{"layers":[{"id":"L1","role":"DESIGN","face":1,"elements":[元素...]}]}

元素规则：
- 必填 id（小写短串且互不重复，如 t1、s2、p3）与 kind；kind 仅允许 "text" | "shape" | "path"（禁止 image——栅格图由用户在画布上传）
- rectMm: {"x":数,"y":数,"w":数,"h":数} 单位毫米，原点=出血框左上角；x+w、y+h 不得超出画布总尺寸；有 [画布上下文] 时，元素须整体落在用户要求的区块坐标内并距区块边缘≥3mm 安全边距
- kind=text：text:{"content":"文字","sizePt":数字}，fill:{"cmyk":[c,m,y,k]}（0-100）；主标题建议 sizePt 18-60，正文 7-12
- kind=shape：矩形色块/底色条，fill:{"cmyk":[...]}
- kind=path：svgPath 为内联 SVG path d 数据（简单线条/几何装饰），禁止 base64
- 大面积深色底避免四色满版（建议单/双色深 + 白字）；纯黑文字用 cmyk [0,0,0,100]

非设计请求正常对话回答，不要输出 JSON。`,
        /** 无联网/检索诉求，关掉 MCP 与 Skills，降低时延并保证输出确定性 */
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