/**
 * @fileOverview 大模型对话频道的设置
 * @author xianyang
 * @module
 */

const llmChannelDataSet = {
    /** 通用聊天助手 */
    micro_common: {
        /** 系统提示词 */
        sysPrompt: `你是一个高校师生教、学助手，请根据用户提供的用户资料回答用户的问题。`,
        /** 增强检索提示词 */
        ragPrompt: `## 用户资料： \n
    {{segs}}`,
        /** 可以调用的MCP配置列表 */
        mcpServers: {
            searxng: {
                transport: 'sse',
                url: 'http://localhost:32769/sse'
            }
        },
        /** 是否启用MCP调用 */
        enableMcp: true,
        /** Agent Skills 配置 */
        skills: {
            /** 是否启用 Skills */
            enabled: true,
            /** 该频道专用的 Skills 列表 */
            skillNames: ['code-reviewer', 'refactoring-expert', 'api-tester', 'document-extractor'],
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
 * @description 校验频道是否在配置中定义
 * @param {string[]} channels 频道列表
 * @returns {string[]} 无效的频道列表
 */
export function validateChannels(channels) {
    const configuredChannels = getConfiguredChannels()
    return channels.filter(channel => !configuredChannels.includes(channel))
}