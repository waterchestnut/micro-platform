/**
 * @fileOverview
 * @author xianyang 2026/4/2
 * @module
 */

import {getGrpcSkillsByChannel} from '../../services/core/grpcSkill.js'
import skillParser from '../skillParser.js'
import {execCommand as execGrpcCommand} from '../../grpc/clients/grpcSkillExecutor.js'

const logger = llm.logger

export class GrpcSkillProvider {
    constructor(channel, curUserInfo) {
        this.channel = channel
        this.skillsCache = new Map()
        this.skillsIndex = new Map()
        this.initialized = false
        this.curUserInfo = curUserInfo
    }

    /**
     * @description 初始化频道内的 Skills
     * @returns {Promise<void>}
     */
    async initialize() {
        let list = await getGrpcSkillsByChannel(this.channel)
        list?.forEach((item) => {
            if (item.skillMD) {
                this.skillsIndex.set(item.skillName, {
                    grpcSkillInfo: item,
                    name: item.skillName
                })
            }
        })
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
            const content = skillInfo.grpcSkillInfo.skillMD
            const skill = skillParser.parseSkillContent(content, skillInfo)
            skill.skillType = 'grpc'
            this.skillsCache.set(skillName, skill)
            return skill
        } catch (error) {
            logger.error(`加载 Skill ${skillName} 失败: ${error.message}`)
            return null
        }
    }

    /**
     * @description 加载多个 Skill
     * @returns {Promise<SkillDefinition[]>}
     */
    async loadSkills() {
        if (!this.initialized) {
            await this.initialize()
        }
        const skills = []
        for (const [skillName, skillIndex] of this.skillsIndex.entries()) {
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
        let skillInfo = this.skillsIndex.get(skill.name)
        if (!skillInfo) {
            return {
                success: false,
                command: command.name,
                error: `技能 ${skillInfo.name} 不存在`,
                message: `命令 ${skillInfo.name}.${command.name} 执行失败：技能 ${skillInfo.name} 不存在`,
            }
        }
        return await execGrpcCommand(skillInfo.grpcSkillInfo.grpcHost, skillInfo.name, command.name, parameters, this.curUserInfo)
    }
}