/**
 * @fileOverview Skills 统一入口和索引
 * @description 导出所有可用的 skills 和便捷函数
 * @module
 */

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