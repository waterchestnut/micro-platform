/**
 * @fileOverview
 * @author xianyang 2026/4/2
 * @module
 */

import fs from 'fs/promises'
import path from 'path'
import skillParser from '../skillParser.js'

const logger = llm.logger
const config = llm.config

/**
 * @description 组装沙箱内执行 skill 所需的入参（抽成纯函数是为了能把"会话透传"这条链测住）
 * @author xianyang
 * @param {Object} params 入参
 * @param {Object} params.skill skill 定义（至少要有 name/path）
 * @param {Object} params.command 命令定义（至少要有 name）
 * @param {Object} params.parameters 命令参数
 * @param {Object} [params.execOptions] 上游透传的执行选项，目前用 conversationCode 做沙箱会话级复用
 * @param {String} params.scriptText 脚本文本
 * @param {Object} [params.sandboxConfig] 沙箱配置
 * @returns {Object} executeSkillInSandbox 的入参
 */
export function buildSkillExecArgs(params = {}) {
    const {skill, command, parameters, execOptions = {}, scriptText, sandboxConfig = {}} = params
    return {
        skillName: skill.name,
        scriptText,
        commandName: command.name,
        parameters,
        /** 能力按配置发放，不给默认全量：没登记的 skill 拿不到任何宿主能力 */
        caps: sandboxConfig?.skillCaps?.[skill.name] || [],
        /** 有会话就复用同一个沙箱；没有才临时建箱（避免每次都建、把池吃满） */
        conversationCode: execOptions.conversationCode || '',
    }
}

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
        for (const skillName of skillNames) {
            const skill = await this.loadSkill(skillName)
            if (skill) {
                skills.push(skill)
            }
        }

        return skills
    }

    /**
     * @description 校验脚本路径未越出 skills 根目录
     * @param {string} skillName - Skill 名称
     * @param {string} scriptsPath - 脚本绝对路径
     * @returns {void}
     */
    assertScriptPath(skillName, scriptsPath) {
        const known = this.skillsIndex.get(skillName)
        if (!known) {
            throw new Error(`Skill ${skillName} 未注册，拒绝执行`)
        }
        const root = path.resolve(path.join(this.skillsDir, this.skillsSubDir))
        const target = path.resolve(scriptsPath)
        if (target !== root && !target.startsWith(root + path.sep)) {
            throw new Error(`Skill ${skillName} 脚本路径越界: ${target}`)
        }
    }

    /**
     * @description 执行指令逻辑
     *
     * 两种模式由 `sandboxConfig.skillExecMode` 决定：
     *   'sandbox'（推荐）：把脚本打包进 OpenSandbox 执行，脚本必须自包含
     *     （只 import Node 内置模块，宿主能力通过短期 token 回连 /core/skill-host/*）；
     *   'local'（默认，向后兼容）：仍在进程内 dynamic import。
     * 两条路径**都先过 assertScriptPath**：未注册即拒、路径越界即拒。沙箱模式不是白名单的替代品，
     * 它消除的是"模型可控代码进本进程"这一面，而"执行哪个文件"仍然由注册表决定。
     * @param {SkillDefinition} skill - Skill 定义
     * @param {SkillCommand} command - 指令定义
     * @param {Object} parameters - 参数
     * @param {Object} [execOptions] - 执行选项：{conversationCode}，透传给沙箱做会话级复用
     * @returns {Promise<any>}
     */
    async executeCommand(skill, command, parameters, execOptions = {}) {
        if (!this.initialized) {
            await this.initialize()
        }
        /*先校验归属与路径，避免越界路径被后续的 ENOENT 分支静默吞掉*/
        const scriptsPath = path.join(skill.path, 'scripts', 'index.js')
        this.assertScriptPath(skill.name, scriptsPath)
        const mode = config.sandboxConfig?.skillExecMode || 'local'
        if (mode === 'sandbox') {
            let scriptText = null
            try {
                scriptText = await fs.readFile(scriptsPath, 'utf-8')
            } catch (e) {
                if (e.code === 'ENOENT') {
                    /** 与 local 模式一致的兜底语义：没脚本就用默认实现，不让 skill 列表整体炸掉 */
                    return {
                        message: `执行了 ${skill.name}.${command.name}`,
                        parameters,
                        note: 'Skill 未提供执行脚本，使用默认实现',
                    }
                }
                throw e
            }
            const {executeSkillInSandbox} = await import('../../services/sandbox/runner.js')
            return await executeSkillInSandbox(
                buildSkillExecArgs({skill, command, parameters, execOptions, scriptText, sandboxConfig: config.sandboxConfig})
            )
        }
        try {
            // 确认 skill 提供了执行脚本
            await fs.access(scriptsPath)

            // 将路径转换为 file:// URL（Windows 兼容）
            const fileUrl = 'file://' + scriptsPath.replace(/\\/g, '/')

            // 动态导入脚本模块；调试期加时间戳以便改脚本即时生效，生产用稳定地址避免模块实例累积泄漏
            const scriptModule = await import(config.debug ? `${fileUrl}?t=${Date.now()}` : fileUrl)

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