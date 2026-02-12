/**
 * @fileOverview Agent Skills 管理器 - 动态加载和管理领域专家技能
 * @description 参考 Claude Agent Skills 设计，支持频道级配置和自动执行
 * @module
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import llmChannelDataSet from '../conf/llmChannel.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const logger = (typeof llm !== 'undefined' && llm?.logger) ? llm.logger : console

/**
 * @description Skill 定义接口
 * @typedef {Object} SkillDefinition
 * @property {string} name - Skill 唯一名称
 * @property {string} description - Skill 描述
 * @property {string} version - 版本号
 * @property {string} author - 作者
 * @property {string[]} tags - 标签数组
 * @property {string} whenToUse - 何时使用此 Skill
 * @property {string} instructions - 使用指令
 * @property {string[]} examples - 使用示例
 * @property {Object} metadata - 元数据
 * @property {SkillCommand[]} commands - 可执行指令列表
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
    constructor() {
        // skills 根目录
        this.skillsDir = __dirname
        // Skill 存放目录
        this.skillsSubDir = 'skills'
        this.skillsCache = new Map() // 缓存已加载的 skills
        this.skillsIndex = new Map() // Skill 索引（名称 -> 路径）
        this.initialized = false
    }

    /**
     * @description 初始化 Skills 系统
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.initialized) return

        try {
            await this.scanAllSkillDirs()
            this.initialized = true
            logger.info(`Skills 系统初始化完成，共加载 ${this.skillsIndex.size} 个 skills`)
        } catch (error) {
            logger.error(`Skills 系统初始化失败: ${error.message}`)
            throw error
        }
    }

    /**
     * @description 扫描所有 Skill 目录
     * @returns {Promise<void>}
     */
    async scanAllSkillDirs() {
        const dirPath = path.join(this.skillsDir, this.skillsSubDir)
        try {
            await fs.access(dirPath)
            await this.scanSkillDir(dirPath)
        } catch {
            logger.warn(`Skill 目录不存在: ${dirPath}`)
        }
    }

    /**
     * @description 扫描单个 Skill 目录
     * @param {string} dir - 目录路径
     * @returns {Promise<void>}
     */
    async scanSkillDir(dir) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true })
            
            for (const entry of entries) {
                // 跳过隐藏目录
                if (entry.name.startsWith('.')) {
                    continue
                }
                
                const fullPath = path.join(dir, entry.name)
                
                if (entry.isDirectory()) {
                    const skillFile = path.join(fullPath, 'SKILL.md')
                    const skillName = entry.name
                    
                    try {
                        // 检查是否包含 SKILL.md
                        await fs.access(skillFile)
                        this.skillsIndex.set(skillName, {
                            path: fullPath,
                            skillFile: skillFile,
                            name: skillName
                        })
                        logger.info(`发现 Skill: ${skillName}`)
                    } catch {
                        // 目录下没有 SKILL.md，递归扫描子目录
                        await this.scanSkills(fullPath, skillName)
                    }
                }
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn(`Skills 目录不存在: ${dir}`)
            } else {
                throw error
            }
        }
    }

    /**
     * @description 获取频道的 Skills 配置
     * @param {string} channel - 频道名称
     * @returns {Object} Skills 配置
     */
    getChannelSkillsConfig(channel) {
        const channelConfig = llmChannelDataSet[channel] || {}
        const defaultConfig = {
            enabled: true,
            skillNames: [],
            maxSkills: 3,
            threshold: 0.3,
            enableSkillExecution: true,
            /** 加载模式：'candidates'(候选列表) | 'matched'(匹配加载) | 'full'(全部加载) */
            loadMode: 'candidates'
        }
        
        return { ...defaultConfig, ...(channelConfig.skills || {}) }
    }

    /**
     * @description 获取频道候选 Skills 列表（仅基础信息）
     * @param {string} channel - 频道名称
     * @returns {Promise<Array<{name: string, description: string, tags: string[]}>>}
     */
    async getChannelSkillCandidates(channel) {
        const config = this.getChannelSkillsConfig(channel)
        
        if (!config.enabled) {
            return []
        }

        if (!this.initialized) {
            await this.initialize()
        }

        // 确定要扫描的 Skills 列表
        const skillsToScan = config.skillNames.length > 0 
            ? config.skillNames.map(name => [name, this.skillsIndex.get(name)]).filter(([_, info]) => info)
            : Array.from(this.skillsIndex.entries())

        const candidates = []
        
        for (const [skillName, skillInfo] of skillsToScan) {
            if (!skillInfo) continue
            
            try {
                // 只读取文件头部获取基础信息
                const content = await fs.readFile(skillInfo.skillFile, 'utf-8')
                const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
                
                let metadata = {}
                if (frontmatterMatch) {
                    metadata = this.parseYaml(frontmatterMatch[1]) || {}
                }
                
                candidates.push({
                    name: skillName,  // 使用带前缀的 skillName
                    displayName: metadata.name || skillName.split('/').pop(),  // 显示名称
                    description: metadata.description || '',
                    tags: metadata.tags || [],
                    version: metadata.version || '1.0.0'
                })
            } catch (error) {
                logger.warn(`读取 Skill ${skillName} 候选信息失败: ${error.message}`)
            }
        }

        return candidates
    }

    /**
     * @description 加载单个 Skill
     * @param {string} skillName - Skill 名称
     * @param {Object} options - 选项
     * @param {boolean} options.detail - 是否加载完整详情（包括 instructions、commands 等）
     * @returns {Promise<SkillDefinition|null>}
     */
    async loadSkill(skillName, options = {}) {
        // 检查缓存
        if (this.skillsCache.has(skillName)) {
            return this.skillsCache.get(skillName)
        }

        const skillInfo = this.skillsIndex.get(skillName)
        if (!skillInfo) {
            logger.warn(`Skill ${skillName} 不存在`)
            return null
        }

        try {
            const content = await fs.readFile(skillInfo.skillFile, 'utf-8')
            const skill = this.parseSkillContent(content, skillInfo)
            this.skillsCache.set(skillName, skill)
            return skill
        } catch (error) {
            logger.error(`加载 Skill ${skillName} 失败: ${error.message}`)
            return null
        }
    }

    /**
     * @description 解析 SKILL.md 文件内容
     * @param {string} content - 文件内容
     * @param {Object} skillInfo - Skill 信息
     * @returns {SkillDefinition}
     */
    parseSkillContent(content, skillInfo) {
        // 解析 YAML Frontmatter
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
        
        let metadata = {}
        let markdown = content

        if (frontmatterMatch) {
            try {
                metadata = this.parseYaml(frontmatterMatch[1]) || {}
                markdown = frontmatterMatch[2].trim()
            } catch (error) {
                logger.warn(`解析 Skill ${skillInfo.name} 的 Frontmatter 失败: ${error.message}`)
            }
        }

        // 解析 Markdown 章节
        const sections = this.parseMarkdownSections(markdown)

        // 解析可执行指令
        const commands = this.parseSkillCommands(sections)

        return {
            name: metadata.name || skillInfo.name,
            description: metadata.description || sections.description || '',
            version: metadata.version || '1.0.0',
            author: metadata.author || 'unknown',
            tags: metadata.tags || [],
            whenToUse: sections['when to use this skill'] || sections['when to use'] || '',
            instructions: sections.instructions || markdown,
            examples: this.parseExamples(sections.examples || ''),
            commands: commands,
            metadata: metadata,
            rawContent: content,
            path: skillInfo.path,
            sections: sections
        }
    }

    /**
     * @description 解析 Skill 可执行指令
     * @param {Object} sections - Markdown 章节
     * @returns {SkillCommand[]}
     */
    parseSkillCommands(sections) {
        const commands = []
        
        // 从 instructions 章节中提取指令
        const instructions = sections.instructions || ''
        
        // 匹配格式：@指令名[参数] 或 @指令名{参数}
        const commandPattern = /@(\w+)(?:\[([^\]]+)\]|\{([^}]+)\})?/g
        let match
        
        while ((match = commandPattern.exec(instructions)) !== null) {
            const commandName = match[1]
            const paramStr = match[2] || match[3] || ''
            
            commands.push({
                name: commandName,
                description: `${commandName} 指令`,
                parameters: this.parseCommandParameters(paramStr)
            })
        }

        return commands
    }

    /**
     * @description 解析指令参数
     * @param {string} paramStr - 参数字符串
     * @returns {Object}
     */
    parseCommandParameters(paramStr) {
        const properties = {}
        const required = []
        
        if (!paramStr) {
            return { type: 'object', properties, required }
        }

        // 解析参数定义：param1:type1, param2:type2
        const params = paramStr.split(',').map(p => p.trim())
        
        for (const param of params) {
            const [name, type = 'string'] = param.split(':').map(s => s.trim())
            if (name) {
                properties[name] = { type: type.toLowerCase() }
                required.push(name)
            }
        }

        return { type: 'object', properties, required }
    }

    /**
     * @description 简单 YAML 解析器（仅支持基本格式）
     * @param {string} yamlContent - YAML 内容
     * @returns {Object}
     */
    parseYaml(yamlContent) {
        const result = {}
        const lines = yamlContent.split(/\r?\n/)
        let currentKey = null
        let currentArray = null

        for (const line of lines) {
            const trimmed = line.trim()
            
            // 跳过空行和注释
            if (!trimmed || trimmed.startsWith('#')) continue

            // 数组项
            if (trimmed.startsWith('- ')) {
                if (currentArray) {
                    currentArray.push(trimmed.slice(2).trim())
                }
                continue
            }

            // 键值对
            const match = trimmed.match(/^(\w+):\s*(.*)$/)
            if (match) {
                const [, key, value] = match
                currentKey = key
                
                if (value) {
                    // 移除引号
                    result[key] = value.replace(/^["']|["']$/g, '')
                    currentArray = null
                } else {
                    // 可能是数组开始
                    result[key] = []
                    currentArray = result[key]
                }
            }
        }

        return result
    }

    /**
     * @description 解析 Markdown 章节
     * @param {string} markdown - Markdown 内容
     * @returns {Object}
     */
    parseMarkdownSections(markdown) {
        const sections = {}
        const lines = markdown.split('\n')
        let currentSection = 'description'
        let currentContent = []

        for (const line of lines) {
            const headerMatch = line.match(/^(#{1,3})\s+(.+)$/i)
            
            if (headerMatch) {
                if (currentContent.length > 0) {
                    sections[currentSection] = currentContent.join('\n').trim()
                }
                currentSection = headerMatch[2].toLowerCase().trim()
                currentContent = []
            } else {
                currentContent.push(line)
            }
        }

        if (currentContent.length > 0) {
            sections[currentSection] = currentContent.join('\n').trim()
        }

        return sections
    }

    /**
     * @description 解析示例
     * @param {string} examplesContent - 示例内容
     * @returns {string[]}
     */
    parseExamples(examplesContent) {
        if (!examplesContent) return []
        
        // 按照数字或项目符号分割示例
        const examples = examplesContent
            .split(/\n\s*(?:\d+\.|[-*])\s+/)
            .map(e => e.trim())
            .filter(e => e.length > 0)
        
        return examples
    }

    /**
     * @description 根据查询和频道配置匹配相关 Skills
     * @param {string} channel - 频道名称
     * @param {string} query - 用户查询
     * @param {Object} options - 匹配选项（会合并频道配置）
     * @returns {Promise<SkillDefinition[]>}
     */
    async matchSkillsForChannel(channel, query, options = {}) {
        const config = this.getChannelSkillsConfig(channel)
        
        if (!config.enabled) {
            return []
        }

        // 合并选项
        const mergedOptions = {
            maxSkills: options.maxSkills || config.maxSkills,
            threshold: options.threshold || config.threshold,
            skillNames: config.skillNames, // 频道指定的 Skills
            ...options
        }

        return await this.matchSkills(query, mergedOptions)
    }

    /**
     * @description 根据查询匹配相关 Skills
     * @param {string} query - 用户查询
     * @param {Object} options - 匹配选项
     * @param {number} options.maxSkills - 最大返回数量
     * @param {number} options.threshold - 匹配阈值 (0-1)
     * @param {string[]} options.skillNames - 限定只从这些 Skills 中匹配
     * @returns {Promise<SkillDefinition[]>}
     */
    async matchSkills(query, options = {}) {
        const { maxSkills = 3, threshold = 0.1, skillNames = [] } = options
        
        if (!this.initialized) {
            await this.initialize()
        }

        const queryLower = query.toLowerCase()
        const matches = []

        // 确定要扫描的 Skills 列表
        const skillsToScan = skillNames.length > 0 
            ? skillNames.map(name => [name, this.skillsIndex.get(name)]).filter(([_, info]) => info)
            : Array.from(this.skillsIndex.entries())

        for (const [skillName, skillInfo] of skillsToScan) {
            if (!skillInfo) continue
            
            const skill = await this.loadSkill(skillName)
            if (!skill) continue

            const score = this.calculateMatchScore(queryLower, skill)
            
            if (score >= threshold) {
                matches.push({ skill, score })
            }
        }

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

        const { enableExecution = true } = context
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
        const skill = await this.loadSkill(skillName)
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
        const result = await this.executeCommandLogic(skill, command, parameters)

        return {
            success: true,
            skill: skillName,
            command: commandName,
            result: result,
            timestamp: new Date().toISOString()
        }
    }

    /**
     * @description 执行指令逻辑（可扩展）
     * @param {SkillDefinition} skill - Skill 定义
     * @param {SkillCommand} command - 指令定义
     * @param {Object} parameters - 参数
     * @returns {Promise<any>}
     */
    async executeCommandLogic(skill, command, parameters) {
        try {
            // 尝试加载 skill 的 scripts/index.js
            const scriptsPath = path.join(skill.path, 'scripts', 'index.js')
            await fs.access(scriptsPath)
            
            // 将路径转换为 file:// URL（Windows 兼容）
            const fileUrl = 'file://' + scriptsPath.replace(/\\/g, '/')
            
            // 动态导入脚本模块
            const scriptModule = await import(fileUrl + '?t=' + Date.now()) // 添加时间戳避免缓存
            
            if (scriptModule.executeCommand) {
                // 使用统一的 executeCommand 入口
                return await scriptModule.executeCommand(command.name, parameters)
            } else if (scriptModule[command.name]) {
                // 使用具名导出
                return await scriptModule[command.name](parameters)
            } else {
                throw new Error(`脚本中未找到命令: ${command.name}`)
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                // 没有 scripts 目录，使用默认实现
                return {
                    message: `执行了 ${skill.name}.${command.name}`,
                    parameters: parameters,
                    note: 'Skill 未提供执行脚本，使用默认实现'
                }
            }
            throw error
        }
    }

    /**
     * @description 解析 LLM 回复中的指令调用
     * @param {string} content - LLM 回复内容
     * @returns {Array} 指令调用列表
     */
    parseSkillCalls(content) {
        const calls = []
        
        // 匹配格式：@指令名{参数对象}
        const pattern = /@(\w+)\{([^}]*)\}/g
        let match
        
        while ((match = pattern.exec(content)) !== null) {
            const commandName = match[1]
            const paramStr = match[2]
            
            try {
                // 尝试解析参数
                const params = this.parseCommandCallParams(paramStr)
                calls.push({
                    command: commandName,
                    parameters: params,
                    raw: match[0]
                })
            } catch (error) {
                logger.warn(`解析指令调用失败: ${match[0]}`, error.message)
            }
        }

        return calls
    }

    /**
     * @description 解析指令调用参数
     * @param {string} paramStr - 参数字符串
     * @returns {Object}
     */
    parseCommandCallParams(paramStr) {
        const params = {}
        
        // 简单的键值对解析：key: value, key2: value2
        const pairs = paramStr.split(',').map(p => p.trim())
        
        for (const pair of pairs) {
            const colonIndex = pair.indexOf(':')
            if (colonIndex > 0) {
                const key = pair.slice(0, colonIndex).trim()
                let value = pair.slice(colonIndex + 1).trim()
                
                // 尝试解析为 JSON
                try {
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = JSON.parse(value)
                    } else if (value === 'true') {
                        value = true
                    } else if (value === 'false') {
                        value = false
                    } else if (!isNaN(value) && value !== '') {
                        value = Number(value)
                    }
                } catch {
                    // 保持字符串
                }
                
                params[key] = value
            }
        }

        return params
    }

    /**
     * @description 根据查询生成增强的系统提示词（支持分级加载）
     * @param {string} channel - 频道名称
     * @param {string} query - 用户查询
     * @param {Object} options - 选项
     * @param {string} options.loadMode - 加载模式：'candidates'(候选列表) | 'matched'(匹配加载) | 'full'(全部加载)
     * @returns {Promise<{prompt: string, skills: SkillDefinition[], tools: Array, candidates: Array}>}
     */
    async generateSystemPromptForChannel(channel, query, options = {}) {
        const config = this.getChannelSkillsConfig(channel)
        
        if (!config.enabled) {
            return { prompt: '', skills: [], tools: [], candidates: [] }
        }

        const loadMode = options.loadMode || config.loadMode || 'candidates'

        // 第一步：获取候选 Skills 列表
        const candidates = await this.getChannelSkillCandidates(channel)
        
        if (candidates.length === 0) {
            return { prompt: '', skills: [], tools: [], candidates: [] }
        }

        let prompt = ''
        let skills = []
        let tools = []

        if (loadMode === 'candidates') {
            // 候选列表模式：只加载名称和描述，让大模型选择
            prompt = this.generateSkillCandidatesPrompt(candidates)
            skills = candidates.map(c => ({ name: c.name, description: c.description, tags: c.tags }))
        } else if (loadMode === 'matched') {
            // 匹配加载模式：先加载候选，然后根据匹配分数加载详细内容
            const matchedSkills = await this.matchSkillsForChannel(channel, query, options)
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
                skills = candidates.map(c => ({ name: c.name, description: c.description, tags: c.tags }))
            }
        } else if (loadMode === 'full') {
            // 全部加载模式：加载所有候选的详细内容
            const fullSkills = []
            for (const candidate of candidates.slice(0, config.maxSkills)) {
                const skill = await this.loadSkill(candidate.name)
                if (skill) fullSkills.push(skill)
            }
            prompt = this.generateSkillsPrompt(fullSkills, {
                enableExecution: config.enableSkillExecution,
                ...options.context
            })
            skills = fullSkills
            tools = config.enableSkillExecution ? this.generateSkillTools(fullSkills) : []
        }

        return { prompt, skills, tools, candidates }
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
        sections.push('4. 请注意，不能直接把技能作为函数调用返回，只有技能的指令才可执行函数调用')
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
        const skill = await this.loadSkill(skillName)
        
        if (!skill) {
            return { prompt: '', skill: null, tools: [] }
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

    /**
     * @description 获取所有可用 Skills 列表
     * @returns {Promise<Array>}
     */
    async listSkills() {
        if (!this.initialized) {
            await this.initialize()
        }

        const skills = []
        for (const [skillName] of this.skillsIndex) {
            const skill = await this.loadSkill(skillName)
            if (skill) {
                skills.push({
                    name: skill.name,
                    description: skill.description,
                    version: skill.version,
                    tags: skill.tags,
                    commands: skill.commands.map(c => c.name)
                })
            }
        }

        return skills
    }

    /**
     * @description 重新加载所有 Skills
     * @returns {Promise<void>}
     */
    async reload() {
        this.skillsCache.clear()
        this.skillsIndex.clear()
        this.initialized = false
        await this.initialize()
        logger.info('Skills 系统已重新加载')
    }

    /**
     * @description 获取 Skill 的详细状态
     * @returns {Object}
     */
    getStatus() {
        return {
            initialized: this.initialized,
            skillsDir: this.skillsDir,
            totalSkills: this.skillsIndex.size,
            cachedSkills: this.skillsCache.size,
            skills: Array.from(this.skillsIndex.keys())
        }
    }
}

// 创建全局实例
export const skillManager = new SkillManager()

// 便捷函数
export async function matchSkills(query, options) {
    return await skillManager.matchSkills(query, options)
}

export async function matchSkillsForChannel(channel, query, options) {
    return await skillManager.matchSkillsForChannel(channel, query, options)
}

export async function generateSystemPromptForChannel(channel, query, options) {
    return await skillManager.generateSystemPromptForChannel(channel, query, options)
}

export async function getChannelSkillCandidates(channel) {
    return await skillManager.getChannelSkillCandidates(channel)
}

export async function generateSkillDetailPrompt(skillName, options) {
    return await skillManager.generateSkillDetailPrompt(skillName, options)
}

export async function listSkills() {
    return await skillManager.listSkills()
}

export async function executeSkillCommand(skillName, commandName, parameters) {
    return await skillManager.executeSkillCommand(skillName, commandName, parameters)
}
