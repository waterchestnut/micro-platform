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
import fs from 'node:fs'
import path from 'node:path'

const llmChannelDataSet = {
    /** 通用聊天助手 */
    micro_common: {
        /** 文本档：入口频道，MCP/Skills/工具链最重，保持 Pro；要压成本可改 relay_common_flash */
        model: 'relay_common_pro',
        /** 带图档：文档截图、拍照题目等走视觉族 Pro */
        visionModel: 'relay_qwen_vl_pro',
        /** 系统提示词（底座通用平台口径；xxzx 高校教学生态提示词在产品仓库，勿互拷） */
        sysPrompt: `你是本平台的智能助手。请依据用户提供的资料与工具检索到的内容回答用户的问题；没有依据的内容不要臆造功能、链接或步骤，不确定的就如实说明。`,
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
        /** 系统提示词（概括版 2026-11-04）：ai-draft 字段/单位/坐标/工艺等细节一律由 editor.console 随消息 [ai-draft契约]/[画布上下文] 段传递（真源：cw2pc.main editor.console/src/pages/Canvas/aiDraftContext.ts），样机/刀版/功能升级无需改本频道配置 */
        sysPrompt: `你是包装印刷行业的 AI 设计助手（CW2PC 包装设计编辑器），帮用户用自然语言完成版面设计。
- 用户消息中的 [ai-draft契约] 与 [画布上下文] 段是本次输出的唯一权威规范：严格按其中的字段、单位、坐标、色值与约束产出，段内没有的规则不要自行发明，段内容随产品版本演进、始终以最新消息为准。
- 用户请求设计/生成版面时，只输出一个 \`\`\`json 代码块（前后最多各附一句简短说明），内容为符合契约的 ai-draft 草稿。
- 缺少 [ai-draft契约] 段而用户要求出稿时，先说明需要画布/契约上下文，不要臆造结构。非设计请求正常对话回答，不要输出 JSON。`,
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

/**
 * ===================== 启动频道扩展层（多平台复用底座）=====================
 * 底座按本文件内置频道为默认；平台部署时可用外部配置**覆盖已有频道 / 注入新频道**，无需改源码。
 * env：
 *   LLM_CHANNEL_EXT_PATH  JSON 文件：{ "<channelCode>": { <频道配置> }, ... }；频道内可用
 *                         sysPromptFile（相对该 JSON 目录解析）承载长提示词。
 *   LLM_CHANNEL_EXT_JSON  内联 JSON（小覆盖；优先级 base < 文件 < 内联）。
 * 语义：逐频道深合并（只改写了的字段、其余继承默认）；数组/标量整替换；值 null 删键；
 *   频道不存在则注入。两 env 都不配 ⇒ 与无扩展层逐字一致（关=现网不变，回退=不设 env）。
 */
function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function deepMergeChannel(base, ext) {
    const out = isPlainObject(base) ? {...base} : {}
    for (const [k, v] of Object.entries(ext || {})) {
        if (v === null) {
            delete out[k]
            continue
        }
        if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMergeChannel(out[k], v)
        else out[k] = v
    }
    return out
}

function resolvePromptFiles(extChannels, baseDir) {
    for (const cfg of Object.values(extChannels || {})) {
        if (cfg && typeof cfg === 'object' && cfg.sysPromptFile) {
            try {
                cfg.sysPrompt = fs.readFileSync(path.resolve(baseDir, cfg.sysPromptFile), 'utf-8').trim()
            } catch (e) {
                console.error(`[llmChannel] sysPromptFile 读取失败 ${cfg.sysPromptFile}: ${e.message}`)
            }
            delete cfg.sysPromptFile
        }
    }
}

export function loadChannelExtensions(env = process.env) {
    const merged = {}
    const filePath = env.LLM_CHANNEL_EXT_PATH
    if (filePath) {
        try {
            const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
            const obj = JSON.parse(fs.readFileSync(abs, 'utf-8'))
            resolvePromptFiles(obj, path.dirname(abs))
            for (const [k, v] of Object.entries(obj)) merged[k] = v
        } catch (e) {
            console.error(`[llmChannel] LLM_CHANNEL_EXT_PATH 解析失败(${filePath}): ${e.message}`)
        }
    }
    const inline = env.LLM_CHANNEL_EXT_JSON
    if (inline) {
        try {
            const obj = JSON.parse(inline)
            resolvePromptFiles(obj, process.cwd())
            for (const [k, v] of Object.entries(obj)) {
                merged[k] = isPlainObject(merged[k]) && isPlainObject(v) ? deepMergeChannel(merged[k], v) : v
            }
        } catch (e) {
            console.error(`[llmChannel] LLM_CHANNEL_EXT_JSON 解析失败: ${e.message}`)
        }
    }
    return merged
}

export function applyChannelExtensions(base = llmChannelDataSet, env = process.env) {
    const ext = loadChannelExtensions(env)
    for (const [channel, cfg] of Object.entries(ext)) {
        base[channel] = deepMergeChannel(base[channel], cfg)
    }
    return base
}

applyChannelExtensions()

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