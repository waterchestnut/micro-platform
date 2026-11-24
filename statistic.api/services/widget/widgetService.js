/**
 * @fileOverview 桌面小组件内容相关的业务操作
 * @module
 */

import msgInfoDac from '../../daos/core/dac/msgInfoDac.js'

/**
 * @description 组装 A2UI v0.9 命令流
 * @param {String} surfaceId 组件表面ID
 * @param {Array} components 组件数组
 * @returns {Array} A2UI 命令数组
 */
function wrapA2uiCommands(surfaceId, components) {
    return [
        {version: 'v0.9', createSurface: {surfaceId, catalogId: 'local://home_card_catalog.json'}},
        {version: 'v0.9', updateComponents: {surfaceId, components}},
    ]
}

/**
 * @description 使用统计小组件内容：近7天我的活跃天数/操作数/常用系统
 * @param {Object} curUserInfo 当前登录用户
 * @returns {Promise<Array>} A2UI 命令数组
 */
export async function getUsageWidget(curUserInfo, surfaceId, homeEndpoint) {
    try {
        let myUserCode = curUserInfo?.userCode
        let items = []

        if (myUserCode) {
            let since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            let rows = await msgInfoDac.getTop(200, {
                status: 0,
                complexFilter: [{'operator.userCode': myUserCode}, {insertTime: {$gte: since}}],
            }, {insertTime: -1})

            let daySet = new Set()
            let sysMap = new Map()
            for (let row of (rows || [])) {
                daySet.add(String(row.insertTime).slice(0, 10))
                let sys = row.sysName || row.sysCode || '未知系统'
                sysMap.set(sys, (sysMap.get(sys) || 0) + 1)
            }

            if ((rows || []).length > 0) {
                items.push({text: `近7天活跃 ${daySet.size} 天，共 ${rows.length} 次操作`, status: 'success'})
                let topSystems = [...sysMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
                for (const [name, count] of topSystems) {
                    items.push({text: `常用【${name}】${count} 次`, status: 'default'})
                }
            }
        }

        if (items.length === 0) {
            items.push({text: '近7天暂无使用记录', status: 'default'})
        }

        let components = [
            {id: 'list_1', component: 'CardList', items},
            {id: 'root', component: 'CardContent', children: ['list_1']},
        ]
        return wrapA2uiCommands(surfaceId, components)
    } catch (error) {
        throw new Error(`获取使用统计数据失败: ${error.message}`)
    }
}
