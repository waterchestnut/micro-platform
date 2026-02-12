/**
 * @fileOverview Skills 统一入口和索引
 * @description 导出所有可用的 skills 和便捷函数
 * @module
 */

export {
    skillManager,
    matchSkills,
    matchSkillsForChannel,
    generateSystemPromptForChannel,
    getChannelSkillCandidates,
    generateSkillDetailPrompt,
    listSkills,
    executeSkillCommand
} from './skillManager.js'

export {
    initSkillChatContext,
    checkSkillSelection,
    executeSkillToolCalls,
    getSkillStats
} from './skillChat.js'

/**
 * @description 预定义的 Skill 名称常量
 */
export const SkillNames = {
    CODE_REVIEWER: 'code-reviewer',
    API_TESTER: 'api-tester',
    REFACTORING_EXPERT: 'refactoring-expert'
}

/**
 * @description 加载模式枚举
 */
export const SkillLoadMode = {
    /** 候选列表模式：只加载名称和描述 */
    CANDIDATES: 'candidates',
    /** 匹配加载模式：根据匹配分数加载 */
    MATCHED: 'matched',
    /** 全部加载模式：加载所有详细内容 */
    FULL: 'full'
}

/**
 * @description 快速获取特定 Skill
 * @param {string} skillName - Skill 名称
 * @returns {Promise<SkillDefinition|null>}
 */
export async function getSkill(skillName) {
    const { skillManager } = await import('./skillManager.js')
    return await skillManager.loadSkill(skillName)
}

/**
 * @description 根据标签查找 Skills
 * @param {string} tag - 标签
 * @returns {Promise<SkillDefinition[]>}
 */
export async function findSkillsByTag(tag) {
    const { skillManager } = await import('./skillManager.js')
    const allSkills = await skillManager.listSkills()
    const matchingSkills = []
    
    for (const skillInfo of allSkills) {
        const skill = await skillManager.loadSkill(skillInfo.name)
        if (skill && skill.tags.includes(tag)) {
            matchingSkills.push(skill)
        }
    }
    
    return matchingSkills
}
