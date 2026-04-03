/**
 * @fileOverview Agent Skills 管理器 - 动态加载和管理领域专家技能
 * @description 参考 Claude Agent Skills 设计，支持频道级配置和自动执行
 * @module
 */

import fs from 'fs/promises'
import llmChannelDataSet from '../conf/llmChannel.js'
import localSkillProvider from './providers/localSkillProvider.js'
import {GrpcSkillProvider} from './providers/grpcSkillProvider.js'

const logger = llm.logger

/**
 * @description Skill 定义接口
 * @typedef {Object} SkillDefinition
 * @property {string} name - Skill 唯一名称
 * @property {string} displayName - 显示名称
 * @property {string} description - Skill 描述
 * @property {string} version - 版本号
 * @property {string} author - 作者
 * @property {string[]} tags - 标签数组
 * @property {string} whenToUse - 何时使用此 Skill
 * @property {string} instructions - 使用指令
 * @property {string[]} examples - 使用示例
 * @property {Object} metadata - 元数据
 * @property {SkillCommand[]} commands - 可执行指令列表
 * @property {string} skillType - Skill 类型：local|grpc
 */

/**
 * @description Skill 指令定义
 * @typedef {Object} SkillCommand
 * @property {string} name - 指令名称
 * @property {string} description - 指令描述
 * @property {Object} parameters - 参数定义（JSON Schema）
 */

/**
 * @description Agent Skills 管理器类
 */
export class SkillManager {
    constructor(channel, curUserInfo) {
        this.channel = channel
        this.localSkillProvider = localSkillProvider
        this.grpcSkillProvider = new GrpcSkillProvider(channel, curUserInfo)
        this.initialized = false
        this.skills = []
        this.curUserInfo = curUserInfo
    }

    /**
     * @description 初始化频道的Skills
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.initialized) return
        const config = this.getSkillsConfig()

        if (!config.enabled) {
            this.skills = []
        } else {

            let skills = await this.grpcSkillProvider.loadSkills()
            if (config.skillNames.length) {
                skills = skills.concat(await this.localSkillProvider.loadSkills(config.skillNames))
            }
            this.skills = skills
        }
        this.initialized = true
    }

    /**
     * @description 获取频道的 Skills 配置
     * @returns {Object} Skills 配置
     */
    getSkillsConfig() {
        const channelConfig = llmChannelDataSet[this.channel] || {}
        const defaultConfig = {
            enabled: true,
            skillNames: [],
            maxSkills: 3,
            threshold: 0.3,
            enableSkillExecution: true,
            /** 加载模式：'candidates'(候选列表) | 'matched'(匹配加载) | 'full'(全部加载) */
            loadMode: 'candidates'
        }

        return {...defaultConfig, ...(channelConfig.skills || {})}
    }

    /**
     * @description 获取频道候选 Skills 列表（仅基础信息）
     * @returns {Promise<Array<{name: string, description: string, tags: string[]}>>}
     */
    async getSkillCandidates() {
        return this.skills.map(skill => ({
            name: skill.name,
            displayName: skill.displayName,
            description: skill.description,
            tags: skill.tags,
            version: skill.version
        }))
    }

    /**
     * @description 根据查询匹配相关 Skills
     * @param {string} query - 用户查询
     * @param {Object} options - 匹配选项
     * @param {number} options.maxSkills - 最大返回数量
     * @param {number} options.threshold - 匹配阈值 (0-1)
     * @returns {Promise<SkillDefinition[]>}
     */
    async matchSkills(query, options = {}) {
        if (!this.skills.length) {
            return []
        }
        const config = this.getSkillsConfig()
        const mergedOptions = {
            maxSkills: options.maxSkills || config.maxSkills,
            threshold: options.threshold || config.threshold,
            ...options
        }
        const {maxSkills = 3, threshold = 0.1} = mergedOptions

        const queryLower = query.toLowerCase()
        const matches = []
        this.skills.forEach(skill => {
            const score = this.calculateMatchScore(queryLower, skill)

            if (score >= threshold) {
                matches.push({skill, score})
            }
        })

        // 按匹配分数排序
        matches.sort((a, b) => b.score - a.score)

        return matches.slice(0, maxSkills).map(m => m.skill)
    }

    /**
     * @description 计算匹配分数
     * @param {string} query - 查询（小写）
     * @param {SkillDefinition} skill - Skill 定义
     * @returns {number}
     */
    calculateMatchScore(query, skill) {
        let score = 0

        // 名称匹配（权重最高）- 支持完整路径和短名称
        const nameParts = skill.name.toLowerCase().split('/')
        const shortName = nameParts[nameParts.length - 1]

        // 检查 skill name 是否包含在 query 中（反过来：query 包含 skill 关键词）
        if (query.includes(shortName)) {
            score += 1.0
        }

        // 检查短名称的分词是否在 query 中
        const nameKeywords = shortName.split(/[-_\s]+/)
        for (const keyword of nameKeywords) {
            if (keyword.length > 2 && query.includes(keyword)) {
                score += 0.5
            }
        }

        // 标签匹配
        for (const tag of skill.tags) {
            const tagLower = tag.toLowerCase()
            if (query.includes(tagLower)) {
                score += 0.8
            } else {
                // 标签分词匹配
                const tagParts = tagLower.split(/[-_\s]+/)
                for (const part of tagParts) {
                    if (part.length > 2 && query.includes(part)) {
                        score += 0.2
                    }
                }
            }
        }

        // 描述关键词匹配
        if (skill.description) {
            const descWords = skill.description.toLowerCase().split(/\s+/)
            for (const word of descWords) {
                if (word.length > 3 && query.includes(word)) {
                    score += 0.1
                }
            }
        }

        // 额外关键词匹配（whenToUse 和 instructions 中的关键词）
        const extraKeywords = ['review', 'test', 'refactor', 'code', 'api', 'bug', 'quality', 'security']
        for (const keyword of extraKeywords) {
            if (query.includes(keyword)) {
                // 检查 skill 是否相关
                const skillText = `${skill.name} ${skill.description || ''} ${skill.whenToUse || ''}`.toLowerCase()
                if (skillText.includes(keyword)) {
                    score += 0.3
                }
            }
        }

        return Math.min(score, 2.0) // 最高2分
    }

    /**
     * @description 生成系统提示词，包含匹配的 Skills
     * @param {SkillDefinition[]} skills - 匹配的 Skills
     * @param {Object} context - 上下文信息
     * @param {boolean} context.enableExecution - 是否启用指令执行
     * @returns {string}
     */
    generateSkillsPrompt(skills, context = {}) {
        if (!skills || skills.length === 0) {
            return ''
        }

        const {enableExecution = true} = context
        const sections = []

        sections.push('# 领域专家技能（Agent Skills）')
        sections.push('')
        sections.push('你是具备以下专业技能的AI助手。在执行任务时，请遵循对应技能的指导。')
        sections.push('')

        for (let i = 0; i < skills.length; i++) {
            const skill = skills[i]
            sections.push(`## 技能 ${i + 1}: ${skill.name}`)
            sections.push('')

            if (skill.description) {
                sections.push(`**描述**: ${skill.description}`)
                sections.push('')
            }

            if (skill.whenToUse) {
                sections.push('**何时使用**:')
                sections.push(skill.whenToUse)
                sections.push('')
            }

            if (skill.instructions) {
                sections.push('**执行指令**:')
                sections.push(skill.instructions)
                sections.push('')
            }

            if (enableExecution && skill.commands && skill.commands.length > 0) {
                sections.push('**可用指令**:')
                for (const cmd of skill.commands) {
                    const paramStr = cmd.parameters.required.length > 0
                        ? `(${cmd.parameters.required.join(', ')})`
                        : '()'
                    sections.push(`- @${cmd.name}${paramStr}: ${cmd.description}`)
                }
                sections.push('')
                sections.push('**指令使用方式**: 在回复中使用 @指令名{参数} 格式调用指令，例如: @analyzeCode{code: "console.log(1)"}')
                sections.push('')
            }

            if (skill.examples && skill.examples.length > 0) {
                sections.push('**示例**:')
                skill.examples.forEach((example, idx) => {
                    sections.push(`${idx + 1}. ${example}`)
                })
                sections.push('')
            }
        }

        return sections.join('\n')
    }

    /**
     * @description 生成 Skill 执行工具定义（用于大模型 Function Calling）
     * @param {SkillDefinition[]} skills - Skills 列表
     * @returns {Array} OpenAI 工具定义数组
     */
    generateSkillTools(skills) {
        if (!skills || skills.length === 0) {
            return []
        }

        const tools = []

        for (const skill of skills) {
            if (!skill.commands || skill.commands.length === 0) continue

            for (const cmd of skill.commands) {
                tools.push({
                    type: 'function',
                    function: {
                        name: `${skill.name.replace(/\//g, '_')}_${cmd.name}`,
                        description: `[${skill.name}] ${cmd.description}`,
                        parameters: cmd.parameters
                    },
                    skillName: skill.name,
                    commandName: cmd.name
                })
            }
        }

        return tools
    }

    /**
     * @description 执行 Skill 指令
     * @param {string} skillName - Skill 名称
     * @param {string} commandName - 指令名称
     * @param {Object} parameters - 指令参数
     * @returns {Promise<Object>}
     */
    async executeSkillCommand(skillName, commandName, parameters = {}) {
        const skill = await this.skills.find(item => item.name === skillName)
        if (!skill) {
            throw new Error(`Skill ${skillName} 不存在`)
        }

        const command = skill.commands.find(c => c.name === commandName)
        if (!command) {
            throw new Error(`指令 ${commandName} 在 Skill ${skillName} 中不存在`)
        }

        logger.info(`执行 Skill 指令: ${skillName}.${commandName}`, parameters)

        // 根据指令类型执行不同的逻辑
        // 这里可以扩展为调用脚本、执行代码等
        const result = skill.skillType === 'grpc' ? (await this.grpcSkillProvider.executeCommand(skill, command, parameters)) : (await this.localSkillProvider.executeCommand(skill, command, parameters))

        return {
            success: true,
            skill: skillName,
            command: commandName,
            result: result,
            timestamp: new Date().toISOString()
        }
    }

    /**
     * @description 根据查询生成增强的系统提示词（支持分级加载）
     * @param {string} query - 用户查询
     * @param {Object} options - 选项
     * @param {string} options.loadMode - 加载模式：'candidates'(候选列表) | 'matched'(匹配加载) | 'full'(全部加载)
     * @returns {Promise<{prompt: string, skills: SkillDefinition[], tools: Array, candidates: Array}>}
     */
    async generateSystemPrompt(query, options = {}) {
        const config = this.getSkillsConfig()

        if (!config.enabled) {
            return {prompt: '', skills: [], tools: [], candidates: []}
        }

        const loadMode = options.loadMode || config.loadMode || 'candidates'

        // 第一步：获取候选 Skills 列表
        const candidates = await this.getSkillCandidates()

        if (candidates.length === 0) {
            return {prompt: '', skills: [], tools: [], candidates: []}
        }

        let prompt = ''
        let skills = []
        let tools = []

        if (loadMode === 'candidates') {
            // 候选列表模式：只加载名称和描述，让大模型选择
            prompt = this.generateSkillCandidatesPrompt(candidates)
            skills = candidates.map(c => ({name: c.name, description: c.description, tags: c.tags}))
        } else if (loadMode === 'matched') {
            // 匹配加载模式：先加载候选，然后根据匹配分数加载详细内容
            const matchedSkills = await this.matchSkills(query, options)
            if (matchedSkills.length > 0) {
                prompt = this.generateSkillsPrompt(matchedSkills, {
                    enableExecution: config.enableSkillExecution,
                    ...options.context
                })
                skills = matchedSkills
                tools = config.enableSkillExecution ? this.generateSkillTools(matchedSkills) : []
            } else {
                // 没有匹配的，返回候选列表
                prompt = this.generateSkillCandidatesPrompt(candidates)
                skills = candidates.map(c => ({name: c.name, description: c.description, tags: c.tags}))
            }
        } else if (loadMode === 'full') {
            // 全部加载模式：加载所有候选的详细内容
            prompt = this.generateSkillsPrompt(this.skills, {
                enableExecution: config.enableSkillExecution,
                ...options.context
            })
            skills = this.skills
            tools = config.enableSkillExecution ? this.generateSkillTools(this.skills) : []
        }

        return {prompt, skills, tools, candidates}
    }

    /**
     * @description 生成候选 Skills 列表提示词（第一步）
     * @param {Array} candidates - 候选 Skills 列表
     * @returns {string}
     */
    generateSkillCandidatesPrompt(candidates) {
        if (!candidates || candidates.length === 0) {
            return ''
        }

        const sections = []

        sections.push('# 可用领域专家技能（Agent Skills）')
        sections.push('')
        sections.push('你拥有以下专业技能可供选择。请根据用户需求，选择合适的技能来协助完成任务。')
        sections.push('')
        sections.push('**使用说明**：')
        sections.push('1. 首先分析用户需求，判断需要使用哪个技能')
        sections.push('2. 如果需要使用某个技能，请回复："我将使用技能：[技能名称]"')
        sections.push('3. 系统会自动加载该技能的详细说明和可用指令')
        sections.push('4. 请严格遵守技能使用的约定，不能使用技能名称作为tool_calls回复')
        sections.push('')
        sections.push('---')
        sections.push('')

        for (let i = 0; i < candidates.length; i++) {
            const skill = candidates[i]
            sections.push(`## ${i + 1}. ${skill.name}`)
            sections.push('')

            if (skill.description) {
                sections.push(`**描述**: ${skill.description}`)
            }

            if (skill.tags && skill.tags.length > 0) {
                sections.push(`**标签**: ${skill.tags.join(', ')}`)
            }

            sections.push('')
        }

        sections.push('---')
        sections.push('')
        sections.push('**注意**：请根据用户问题选择最合适的技能。如果需要使用多个技能，请按顺序说明。')

        return sections.join('\n')
    }

    /**
     * @description 生成单个 Skill 详细提示词（第二步）
     * @param {string} skillName - Skill 名称
     * @param {Object} options - 选项
     * @returns {Promise<{prompt: string, skill: SkillDefinition|null, tools: Array}>}
     */
    async generateSkillDetailPrompt(skillName, options = {}) {
        const skill = await this.skills.find(item => item.name === skillName)

        if (!skill) {
            return {prompt: '', skill: null, tools: []}
        }

        const sections = []

        sections.push(`# 技能详细说明：${skill.name}`)
        sections.push('')

        if (skill.description) {
            sections.push(`**描述**: ${skill.description}`)
            sections.push('')
        }

        if (skill.whenToUse) {
            sections.push('**何时使用**:')
            sections.push(skill.whenToUse)
            sections.push('')
        }

        if (skill.instructions) {
            sections.push('**执行指令**:')
            sections.push(skill.instructions)
            sections.push('')
        }

        if (options.enableExecution && skill.commands && skill.commands.length > 0) {
            sections.push('**可用指令**:')
            for (const cmd of skill.commands) {
                const paramStr = cmd.parameters.required.length > 0
                    ? `(${cmd.parameters.required.join(', ')})`
                    : '()'
                sections.push(`- @${cmd.name}${paramStr}: ${cmd.description}`)
            }
            sections.push('')
            sections.push('**指令使用方式**: 在回复中使用 @指令名{参数} 格式调用指令')
            sections.push('')
        }

        if (skill.examples && skill.examples.length > 0) {
            sections.push('**示例**:')
            skill.examples.forEach((example, idx) => {
                sections.push(`${idx + 1}. ${example}`)
            })
            sections.push('')
        }

        const tools = options.enableExecution
            ? this.generateSkillTools([skill])
            : []

        return {
            prompt: sections.join('\n'),
            skill,
            tools
        }
    }
}