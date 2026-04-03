/**
 * @fileOverview Skills 聊天集成模块
 * @description 封装与大模型交互时的 Skills 管理逻辑
 * @module
 */

import {mcpToolManager} from '../mcp/index.js'
import {SkillManager} from './skillManager.js'

const logger = llm.logger

/**
 * @description Skills 聊天上下文
 * @typedef {Object} SkillChatContext
 * @property {string} channel - 频道名称
 * @property {Array} candidates - 候选 Skills 列表
 * @property {Array} matchedSkills - 已匹配的 Skills
 * @property {Array} loadedDetails - 已加载详情的 Skills 名称列表
 * @property {Array} tools - 可用的工具列表
 */

export class SkillChat {
    constructor(channel) {
        this.channel = channel
        this.skillManager = new SkillManager(channel)
    }

    /**
     * @description 初始化 Skills 聊天上下文
     * @param {string} query - 用户查询
     * @param {Object} options - 选项
     * @param {string} options.loadMode - 加载模式：'candidates' | 'matched' | 'full'
     * @param {Object} options.context - 额外上下文
     * @returns {Promise<{prompt: string, context: SkillChatContext}>}
     */
    async initSkillChatContext(query, options = {}) {
        const result = await this.skillManager.generateSystemPrompt(query, {
            ...options,
            loadMode: options.loadMode || 'candidates',
            context: options.context
        })

        const context = {
            channel: this.channel,
            candidates: result.candidates,
            matchedSkills: result.skills,
            loadedDetails: [],
            tools: result.tools
        }

        return {
            prompt: result.prompt,
            context
        }
    }

    /**
     * @description 检查大模型回复中是否选择了技能，并加载技能详情
     * @param {string} content - 大模型回复内容
     * @param {SkillChatContext} skillContext - Skills 上下文
     * @returns {Promise<{name: string, prompt: string, tools: Array}|null>}
     */
    async checkSkillSelection(content, skillContext) {
        const {candidates, loadedDetails, channel} = skillContext

        // 检查是否已经加载过任何技能详情
        if (loadedDetails.length > 0) {
            return null
        }

        // 匹配"我将使用技能：[技能名称]"或类似格式
        const patterns = [
            /我将使用技能[：:]\s*(.+?)(?:\n|$)/i,
            /使用技能[：:]\s*(.+?)(?:\n|$)/i,
            /选择技能[：:]\s*(.+?)(?:\n|$)/i,
            /\[使用技能\][：:]?\s*(.+?)(?:\n|$)/i
        ]

        let selectedSkillName = null

        for (const pattern of patterns) {
            const match = content.match(pattern)
            if (match) {
                selectedSkillName = match[1].trim()
                break
            }
        }

        if (!selectedSkillName) {
            return null
        }

        // 在候选列表中查找匹配的技能
        const candidate = candidates.find(c =>
            c.name === selectedSkillName ||
            c.name.endsWith('/' + selectedSkillName)
        )

        if (!candidate) {
            logger.warn(`选择的技能 ${selectedSkillName} 不在候选列表中`)
            return null
        }

        // 检查是否已经加载过
        if (loadedDetails.includes(candidate.name)) {
            return null
        }

        try {
            // 加载技能详情
            const config = this.skillManager.getSkillsConfig()
            const detailResult = await this.skillManager.generateSkillDetailPrompt(candidate.name, {
                enableExecution: config.enableSkillExecution
            })

            if (!detailResult.skill) {
                return null
            }

            // 更新上下文
            skillContext.loadedDetails.push(candidate.name)
            if (detailResult.tools.length > 0) {
                skillContext.tools.push(...detailResult.tools)
            }

            return {
                name: candidate.name,
                prompt: detailResult.prompt,
                tools: detailResult.tools
            }
        } catch (error) {
            logger.error(`加载技能详情失败: ${error.message}`)
            return null
        }
    }

    /**
     * @description 执行工具调用（支持 MCP 工具和 Skill 工具）
     * @param {Array} toolCalls - 工具调用数组
     * @param {SkillChatContext} skillContext - Skills 上下文
     * @returns {Promise<Array>}
     */
    async executeSkillToolCalls(toolCalls, skillContext) {
        const {channel, matchedSkills} = skillContext
        const results = []

        for (const toolCall of toolCalls) {
            const {id: toolCallId, function: functionCall} = toolCall
            const toolName = functionCall.name

            try {
                // 检查是否是 Skill 工具
                const isSkillTool = matchedSkills.some(skill =>
                    toolName.startsWith(skill.name.replace(/\//g, '_'))
                )

                if (isSkillTool) {
                    // 执行 Skill 指令
                    const result = await this.executeSingleSkillTool(toolName, functionCall.arguments, matchedSkills)
                    results.push({
                        tool_call_id: toolCallId,
                        role: 'tool',
                        content: JSON.stringify(result)
                    })
                } else {
                    // 执行 MCP 工具
                    const result = await mcpToolManager.executeSingleToolCall(channel, toolCall)
                    results.push(result)
                }
            } catch (error) {
                logger.error(`工具调用失败 ${toolName}: ${error.message}`)
                results.push({
                    tool_call_id: toolCallId,
                    role: 'tool',
                    content: JSON.stringify({
                        success: false,
                        error: error.message,
                        tool: toolName
                    })
                })
            }
        }

        return results
    }

    /**
     * @description 执行单个 Skill 工具调用
     * @param {string} toolName - 工具名称
     * @param {string} argsJson - 参数 JSON
     * @param {Array} matchedSkills - 匹配的 Skills
     * @returns {Promise<Object>}
     */
    async executeSingleSkillTool(toolName, argsJson, matchedSkills) {
        // 解析工具名：skillName_commandName
        const firstUnderscore = toolName.indexOf('_')
        if (firstUnderscore === -1) {
            throw new Error(`无效的 Skill 工具名: ${toolName}`)
        }

        // 查找匹配的 skill
        let skillName = null
        for (const skill of matchedSkills) {
            const normalizedName = skill.name.replace(/\//g, '_')
            if (toolName.startsWith(normalizedName + '_')) {
                skillName = skill.name
                break
            }
        }

        if (!skillName) {
            throw new Error(`未找到对应的 Skill: ${toolName}`)
        }

        const commandName = toolName.slice(skillName.replace(/\//g, '_').length + 1)
        const parameters = JSON.parse(argsJson || '{}')

        logger.info(`执行 Skill 工具: ${skillName}.${commandName}`, parameters)

        // 调用 skillManager 执行指令
        const result = await this.skillManager.executeSkillCommand(skillName, commandName, parameters)

        return result
    }

    /**
     * @description 获取 Skills 执行统计信息
     * @param {SkillChatContext} skillContext - Skills 上下文
     * @returns {Object}
     */
    getSkillStats(skillContext) {
        return {
            candidates: skillContext.candidates.map(c => c.name),
            loadedDetails: skillContext.loadedDetails,
            toolCount: skillContext.tools.length,
            matchedCount: skillContext.matchedSkills.length
        }
    }
}

