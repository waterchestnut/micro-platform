/**
 * @fileOverview
 * @author xianyang 2026/4/2
 * @module
 */

import fs from 'fs/promises'
import path from 'path'
import skillParser from '../skillParser.js'

const logger = llm.logger

/**
 * @description Agent Skills 管理器类
 */
export class LocalSkillProvider {
    constructor() {
        // skills 根目录
        this.skillsDir = llm.baseDir + 'skill'
        // Skill 存放目录
        this.skillsSubDir = 'skills'
        // 缓存已加载的 skills
        this.skillsCache = new Map()
        // Skill 索引（名称 -> 路径）
        this.skillsIndex = new Map()
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
            logger.info(`Local Skills 系统初始化完成，共加载 ${this.skillsIndex.size} 个 skills`)
        } catch (error) {
            logger.error(`Local Skills 系统初始化失败: ${error.message}`)
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
            const entries = await fs.readdir(dir, {withFileTypes: true})

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
                        // 目录下没有 SKILL.md
                        logger.warn(`SKILL.md不存在: ${fullPath}`)
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
     * @description 加载单个 Skill
     * @param {string} skillName - Skill 名称
     * @returns {Promise<SkillDefinition|null>}
     */
    async loadSkill(skillName) {
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
            let skill = skillParser.parseSkillContent(content, skillInfo)
            skill.skillType = 'local'
            this.skillsCache.set(skillName, skill)
            return skill
        } catch (error) {
            logger.error(`加载 Skill ${skillName} 失败: ${error.message}`)
            return null
        }
    }

    /**
     * @description 加载多个 Skill
     * @param {string[]} skillNames - Skill 名称列表
     * @returns {Promise<SkillDefinition[]>}
     */
    async loadSkills(skillNames) {
        if (!this.initialized) {
            await this.initialize()
        }
        const skills = []
        for (const skillName in skillNames) {
            const skill = await this.loadSkill(skillName)
            if (skill) {
                skills.push(skill)
            }
        }

        return skills
    }

    /**
     * @description 执行指令逻辑
     * @param {SkillDefinition} skill - Skill 定义
     * @param {SkillCommand} command - 指令定义
     * @param {Object} parameters - 参数
     * @returns {Promise<any>}
     */
    async executeCommand(skill, command, parameters) {
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
        logger.info('Local Skills 系统已重新加载')
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

export const localSkillProvider = new LocalSkillProvider()

export default localSkillProvider

export async function listSkills() {
    return await localSkillProvider.listSkills()
}