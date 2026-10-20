/**
 * @fileOverview 远程gRPC技能相关的业务操作
 * @author xianyang 2026/4/1
 * @module
 */

import grpcSkillDac from '../../daos/core/dac/grpcSkillDac.js'
import {remember, cacheDel} from '../../daos/cache/l2Cache.js'
import {listSkills} from '../../skill/providers/localSkillProvider.js'
import {validateChannels} from '../../conf/llmChannel.js'
import yaml from 'js-yaml'

const tools = llm.tools
const logger = llm.logger

/**
 * @description 校验 skillMD 是否符合 SKILL.md 规范
 * @author xianyang
 * @param {String} skillMD skillMD 内容
 * @throws {Error} 校验失败时抛出错误
 */
export function validateSkillMD(skillMD) {
    if (!skillMD || typeof skillMD !== 'string') {
        throw new Error('skillMD 不能为空')
    }

    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/
    const match = skillMD.match(frontmatterRegex)

    if (!match) {
        throw new Error('skillMD 缺少 YAML frontmatter (--- 开头和结尾)')
    }

    let metadata
    try {
        metadata = yaml.load(match[1])
    } catch (e) {
        throw new Error(`skillMD frontmatter 格式错误: ${e.message}`)
    }

    if (!metadata || typeof metadata !== 'object') {
        throw new Error('skillMD frontmatter 解析失败')
    }

    const requiredFields = ['name', 'description', 'author', 'version', 'tags']
    for (const field of requiredFields) {
        if (!metadata[field]) {
            throw new Error(`skillMD frontmatter 缺少必需字段: ${field}`)
        }
    }

    if (typeof metadata.name !== 'string' || !metadata.name.trim()) {
        throw new Error('skillMD frontmatter 中 name 必须是字符串且不能为空')
    }

    if (typeof metadata.description !== 'string' || !metadata.description.trim()) {
        throw new Error('skillMD frontmatter 中 description 必须是字符串且不能为空')
    }

    if (typeof metadata.author !== 'string' || !metadata.author.trim()) {
        throw new Error('skillMD frontmatter 中 author 必须是字符串且不能为空')
    }

    if (typeof metadata.version !== 'string' || !metadata.version.trim()) {
        throw new Error('skillMD frontmatter 中 version 必须是字符串且不能为空')
    }

    if (!Array.isArray(metadata.tags) || metadata.tags.length === 0) {
        throw new Error('skillMD frontmatter 中 tags 必须是数组且不能为空')
    }

    const content = skillMD.slice(match[0].length).trim()
    if (!content) {
        throw new Error('skillMD 内容不能为空')
    }

    const requiredSections = ['# ', '## When to Use This Skill', '## Instructions']
    for (const section of requiredSections) {
        if (!content.includes(section)) {
            throw new Error(`skillMD 内容缺少必需章节: ${section}`)
        }
    }

    const titleMatch = content.match(/^#\s+(.+)$/m)
    if (titleMatch && titleMatch[1] !== metadata.name && titleMatch[1] !== metadata.description.split('(')[0].trim()) {
        logger.warn(`skillMD 标题 "${titleMatch[1]}" 与 name "${metadata.name}" 不匹配`)
    }
}

/**
 * @description 获取远程技能列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 技能数组}
 */
export async function getGrpcSkills(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let dacOptions = {...filter}
    if (options.sort) {
        dacOptions.sort = options.sort
    } else {
        dacOptions.sort = {updateTime: -1}
    }
    if (options.total) {
        dacOptions.total = options.total
    }
    return grpcSkillDac.getByPage(pageIndex, pageSize, dacOptions)
}

/**
 * @description 获取远程技能详情
 * @author xianyang
 * @param {String} skillCode 技能标识
 * @returns {Promise<Object>} 技能详细信息
 */
export async function getGrpcSkill(skillCode) {
    return grpcSkillDac.getByCode(skillCode)
}

/**
 * @description 获取远程技能详情
 * @author xianyang
 * @param {String} channel 频道名称
 * @returns {Promise<Object[]>} 可用技能列表
 */
export async function getGrpcSkillsByChannel(channel) {
    return grpcSkillDac.getTop(1000, {channels: channel, status: 0})
}

/** LRU 命名空间，写入技能时整片清掉 */
export const GRPC_SKILL_SPACE = 'grpcSkill'

/**
 * @description 频道技能清单的缓存键
 * @author xianyang
 * @param {String} channel 频道名称
 * @returns {String} 缓存键
 */
export function grpcSkillCacheKey(channel) {
    return `skill:chan:${channel}`
}

/**
 * @description 按频道取技能清单（LRU + redis 两级）
 * 每次聊天都直查一次 Mongo 是纯浪费：技能清单只在后台改动时变，改动量以天计。
 * 注意 redis 往返会把 Date 变成 ISO 字符串，消费方只能用纯数据字段。
 * @author xianyang
 * @param {String} channel 频道名称
 * @returns {Promise<Object[]>} 技能记录列表
 */
export async function getCachedGrpcSkillsByChannel(channel) {
    const cfg = llm.config.cache || {}
    if (!cfg.skillEnabled || !channel) {
        return getGrpcSkillsByChannel(channel)
    }
    try {
        const {value, source} = await remember({
            key: grpcSkillCacheKey(channel),
            loader: () => getGrpcSkillsByChannel(channel),
            options: {ttlSeconds: cfg.skillTtlSeconds, space: GRPC_SKILL_SPACE},
        })
        if (source !== 'origin') {
            llm.logger.info(`频道 ${channel} 技能清单命中 ${source}，共 ${value?.length ?? 0} 条`)
        }
        return value || []
    } catch (e) {
        llm.logger.warn(`技能缓存读取异常，直接回源(${channel}): ${e.message}`)
        return getGrpcSkillsByChannel(channel)
    }
}

/**
 * @description 技能有增删改启停时清掉全部频道缓存
 * 改动可能同时影响多个频道（一条技能的 channels 可以是列表），
 * 逐个频道失效容易漏，写入频率极低，整片清更稳。
 * @author xianyang
 * @returns {Promise<Number>} 清掉的 redis 键数
 */
export async function invalidateGrpcSkillCache() {
    try {
        const n = await cacheDel('skill:chan:*', GRPC_SKILL_SPACE)
        llm.logger.info(`技能清单缓存已失效，清除 redis 键 ${n} 个`)
        return n
    } catch (e) {
        llm.logger.warn(`技能缓存失效操作失败: ${e.message}`)
        return 0
    }
}

/**
 * @description 添加远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {Object} grpcSkillInfo 技能信息
 * @returns {Promise<Object>} 添加成功时返回新添加的技能对象
 */
export async function addGrpcSkill(curUserInfo, grpcSkillInfo) {
    if (!grpcSkillInfo) {
        throw new Error('未传递技能数据')
    }
    if (!grpcSkillInfo.skillName) {
        throw new Error('需要技能名称')
    }
    if (!grpcSkillInfo.skillMD) {
        throw new Error('需要技能描述')
    }

    validateSkillMD(grpcSkillInfo.skillMD)

    if (!grpcSkillInfo.grpcHost) {
        throw new Error('需要远程主机地址')
    }
    if (!grpcSkillInfo.clientCode) {
        throw new Error('需要所属应用标识')
    }
    if (!grpcSkillInfo.channels || !grpcSkillInfo.channels.length) {
        throw new Error('需要指定聊天频道')
    }

    const invalidChannels = validateChannels(grpcSkillInfo.channels)
    if (invalidChannels.length > 0) {
        throw new Error(`无效的频道: ${invalidChannels.join(', ')}，这些频道未在配置中定义`)
    }

    const skillNameRegex = /^[a-z][a-z0-9-]*$/
    if (!skillNameRegex.test(grpcSkillInfo.skillName)) {
        throw new Error('技能名称格式不正确，只能包含小写英文字母、数字、短横线，且首字符必须是英文字母')
    }

    const existingGrpcSkill = await grpcSkillDac.getOneByFilter({skillName: grpcSkillInfo.skillName, status: {$ne: -1}})
    if (existingGrpcSkill) {
        throw new Error('技能名称已存在')
    }

    const localSkills = await listSkills()
    const localSkillNames = localSkills.map(s => s.name)
    if (localSkillNames.includes(grpcSkillInfo.skillName)) {
        throw new Error('技能名称已存在')
    }

    grpcSkillInfo.skillCode = grpcSkillInfo.skillCode || tools.getUUID()

    let oldGrpcSkill = await grpcSkillDac.getByCode(grpcSkillInfo.skillCode)
    if (oldGrpcSkill) {
        throw new Error('技能标识已存在')
    }

    let newGrpcSkill = {
        skillCode: grpcSkillInfo.skillCode,
        skillName: grpcSkillInfo.skillName,
        skillMD: grpcSkillInfo.skillMD,
        grpcHost: grpcSkillInfo.grpcHost,
        clientCode: grpcSkillInfo.clientCode,
        channels: grpcSkillInfo.channels,
        note: grpcSkillInfo.note,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
        tags: grpcSkillInfo.tags,
    }
    let ret = await grpcSkillDac.add(newGrpcSkill)
    await invalidateGrpcSkillCache()
    return ret
}

/**
 * @description 修改远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} skillCode 技能标识
 * @param {Object} newGrpcSkillInfo 新的技能对象
 * @returns {Promise<Object>} 受影响的行数
 */
export async function updateGrpcSkill(curUserInfo, skillCode, newGrpcSkillInfo) {
    if (!skillCode) {
        throw new Error('缺少技能标识')
    }
    if (!newGrpcSkillInfo) {
        throw new Error('没有要更新的数据')
    }

    const currentSkill = await grpcSkillDac.getByCode(skillCode)
    if (!currentSkill) {
        throw new Error('要更新的技能不存在')
    }

    if (newGrpcSkillInfo.skillName && currentSkill.skillName !== newGrpcSkillInfo.skillName) {
        const skillNameRegex = /^[a-z][a-z0-9-]*$/
        if (!skillNameRegex.test(newGrpcSkillInfo.skillName)) {
            throw new Error('技能名称格式不正确，只能包含小写英文字母、数字、短横线，且首字符必须是英文字母')
        }

        const existingGrpcSkill = await grpcSkillDac.getOneByFilter({
            skillName: newGrpcSkillInfo.skillName,
            status: {$ne: -1}
        })
        if (existingGrpcSkill) {
            throw new Error('技能名称已存在')
        }

        const localSkills = await listSkills()
        const localSkillNames = localSkills.map(s => s.name)
        if (localSkillNames.includes(newGrpcSkillInfo.skillName)) {
            throw new Error('技能名称已存在')
        }
    }

    if (newGrpcSkillInfo.skillMD) {
        validateSkillMD(newGrpcSkillInfo.skillMD)
    }

    if (newGrpcSkillInfo.channels) {
        const invalidChannels = validateChannels(newGrpcSkillInfo.channels)
        if (invalidChannels.length > 0) {
            throw new Error(`无效的频道: ${invalidChannels.join(', ')}，这些频道未在配置中定义`)
        }
    }

    let grpcSkillInfo = {
        skillCode,
        skillName: newGrpcSkillInfo.skillName,
        skillMD: newGrpcSkillInfo.skillMD,
        grpcHost: newGrpcSkillInfo.grpcHost,
        channels: newGrpcSkillInfo.channels,
        note: newGrpcSkillInfo.note,
        tags: newGrpcSkillInfo.tags,
    }

    let ret = await grpcSkillDac.update(grpcSkillInfo)
    await invalidateGrpcSkillCache()
    return ret
}

/**
 * @description 删除远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} skillCode 技能标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteGrpcSkill(curUserInfo, skillCode) {
    if (!skillCode) {
        throw new Error('缺少技能标识')
    }

    const ret = await grpcSkillDac.update({skillCode, status: -1})
    await invalidateGrpcSkillCache()
    return ret
}

/**
 * @description 启用远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} skillCode 技能标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function enableGrpcSkill(curUserInfo, skillCode) {
    if (!skillCode) {
        throw new Error('缺少技能标识')
    }

    const ret = await grpcSkillDac.update({skillCode, status: 0})
    await invalidateGrpcSkillCache()
    return ret
}

/**
 * @description 禁用远程技能
 * @author xianyang
 * @param {Object} curUserInfo 当前用户
 * @param {String} skillCode 技能标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function disableGrpcSkill(curUserInfo, skillCode) {
    if (!skillCode) {
        throw new Error('缺少技能标识')
    }

    const ret = await grpcSkillDac.update({skillCode, status: 1})
    await invalidateGrpcSkillCache()
    return ret
}