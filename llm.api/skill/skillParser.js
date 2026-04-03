/**
 * @fileOverview 技能的解析器
 * @author xianyang 2026/4/2
 * @module
 */

import yaml from 'js-yaml'

const logger = llm.logger

export class SkillParser {
    constructor() {}

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
            displayName: metadata.name || skillInfo.name.split('/').pop(),
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
     * @description 解析 YAML Frontmatter
     * @param {string} yamlContent - YAML 内容
     * @returns {Object}
     */
    parseYaml(yamlContent) {
        try {
            return yaml.load(yamlContent)
        } catch (error) {
            logger.warn(`YAML 解析失败: ${error.message}`)
            return {}
        }
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

}

export default new SkillParser()