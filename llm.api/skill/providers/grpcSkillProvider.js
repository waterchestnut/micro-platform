/**
 * @fileOverview
 * @author xianyang 2026/4/2
 * @module
 */

import {getCachedGrpcSkillsByChannel} from '../../services/core/grpcSkill.js'
import skillParser from '../skillParser.js'
import {execCommand as execGrpcCommand} from '../../grpc/clients/grpcSkillExecutor.js'
import crypto from 'node:crypto'
import {buildHandoffConfirmUrl} from '../../services/core/skill/skillHandoff.js'

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
        /** 走两级缓存：技能清单只在后台改动时变，不该每次聊天都回源一次 Mongo */
        let list = await getCachedGrpcSkillsByChannel(this.channel)
        list?.forEach((item) => {
            // 可调用技能必须有 grpcHost；guide 条目（effectClass=guide、无后端）不进可调用候选，
            // 只由 platform_features 目录承载（那里有 per-user 两层权限过滤）。
            // 用 grpcHost 有无判"可否调用"，不依赖 effectClass 标注（add 出来的可调用散件不会因默认 guide 被误剔）。
            if (item.skillMD && item.grpcHost) {
                this.skillsIndex.set(item.skillName, {
                    grpcSkillInfo: item,
                    name: item.skillName
                })
            }
        })
        this.initialized = true
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
    async executeCommand(skill, command, parameters, execOptions = {}) {
        if (!this.initialized) {
            await this.initialize()
        }
        let skillInfo = this.skillsIndex.get(skill.name)
        if (!skillInfo) {
            return {
                success: false,
                command: command.name,
                error: `技能 ${skill.name} 不存在`,
                message: `命令 ${skill.name}.${command.name} 执行失败：技能 ${skill.name} 不存在`,
            }
        }
        /**
         * handoff 分支（feature-map §4B 复杂写）：命中 skillHandoff.handoffCommands 申报的命令，
         * 不直调 grpc 落库，而是落 journal.proposed + 签一次性确认 token + 回深链（用户在确认页
         * 二次确认→skill-handoff/redeem 才真正落库）。**安全**：命中名单即 handoff，未开闸时拒执行
         * （绝不 fall-through 到 grpc 直调，防止误把写命令当读技能静默落库）。
         */
        const shCfg = (typeof llm !== 'undefined' && llm.config?.skillHandoff) || {}
        const spec = (shCfg.handoffCommands || []).find((h) => h.command === `${skill.name}.${command.name}`)
        if (spec) {
            if (shCfg.enabled !== true) {
                return {success: false, command: command.name, error: 'skill-handoff 未开闸', message: `命令 ${skill.name}.${command.name} 需确认流程执行，当前未开放`}
            }
            const userCode = this.curUserInfo?.userCode || ''
            const {proposeHandoff, buildJumpUrl} = await import('../../services/core/skill/skillHandoff.js')
            // jump 模式：无后端落库、无 token——把 AI 组装参数编成 query 深链跳子系统 create 页，
            // 用户在预填页复核并【本人提交】。适用无草稿态/一步强校验/直提有危险副作用的操作（thesis）。
            if (spec.mode === 'jump') {
                const jumpUrl = buildJumpUrl(shCfg.confirmBaseUrl, spec, parameters || {})
                return {
                    success: true, skill: skill.name, command: command.name, handoff: true, jump: true,
                    confirmUrl: jumpUrl, message: `已按你的意图准备好「${spec.title || command.name}」的预填页面，请把下面的链接交给用户，由用户在页面上复核并本人提交`,
                    hint: '本操作不代为提交；用户需在打开的页面上确认并提交。切勿声称已完成',
                }
            }
            const r = await proposeHandoff({
                key: `handoff:${skill.name}:${command.name}:${crypto.randomUUID()}`,
                skillName: skill.name, commandName: command.name, params: parameters || {},
                userCode, conversationCode: execOptions.conversationCode || skillInfo.grpcSkillInfo?.conversationCode || '',
            })
            if (!r.ok) {
                return {success: false, command: command.name, error: `提案失败: ${r.reason}`, message: '生成待确认草稿失败，请稍后重试或改用页面操作'}
            }
            const confirmUrl = buildHandoffConfirmUrl(shCfg.confirmBaseUrl, spec, r.token)
            return {
                success: true, skill: skill.name, command: command.name, handoff: true,
                confirmUrl, message: `已准备好「${spec.title || command.name}」的草稿，请把下面的确认链接交给用户，由用户在确认页二次确认后才会真正创建`,
                hint: '在未确认前不得声称已创建；本操作的复杂后续（多次回写/确认）都在用户跳转后的页面完成',
            }
        }
        return await execGrpcCommand(skillInfo.grpcSkillInfo.grpcHost, skillInfo.name, command.name, parameters, this.curUserInfo)
    }
}