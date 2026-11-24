/**
 * @fileOverview 桌面小组件内容相关的业务操作
 * @module
 */

import favDac from '../../daos/core/dac/favDac.js'
import resInfoDac from '../../daos/core/dac/resInfoDac.js'
import {clientJumpUrl} from '../../tools/index.js'

const DAY_MS = 24 * 60 * 60 * 1000

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
 * @description 批量反查收藏资源的可读标题（resInfo 命不到时回落 resType+短码，不出裸 hash 长串）
 * @param {Array} favs 收藏记录
 * @returns {Promise<Array>} 条目文案数组
 */
async function resolveFavTitles(favs, homeEndpoint) {
    let codes = favs.map(f => f.resCode).filter(Boolean)
    let titleMap = new Map()
    if (codes.length > 0) {
        let rows = await resInfoDac.getTop(codes.length, {complexFilter: [{resCode: {$in: codes}}]})
        for (let row of (rows || [])) {
            if (row.title) titleMap.set(row.resCode, row.title)
        }
    }
    return favs.map(f => {
        let readable = titleMap.get(f.resCode) || (f.resType || '资源') + ' ' + String(f.resCode).slice(0, 8)
        return {text: '【收藏】' + readable, status: 'success', url: clientJumpUrl('callin-search', `/res/detail/${f.resCode}`, homeEndpoint)}
    })
}

/**
 * @description 资源收藏小组件内容：近30天新增收藏数与最近收藏条目
 * @param {Object} curUserInfo 当前登录用户
 * @returns {Promise<Array>} A2UI 命令数组
 */
export async function getFavoriteWidget(curUserInfo, surfaceId, homeEndpoint) {
    try {
        let myUserCode = curUserInfo?.userCode
        let components = []
        let rootChildren = []

        if (myUserCode) {
            let since = new Date(Date.now() - 30 * DAY_MS)
            let recent = await favDac.getTop(3, {complexFilter: [{userCode: myUserCode}, {favTime: {$gte: since}}]}, {favTime: -1})
            let totalCount = await favDac.getCount({complexFilter: [{userCode: myUserCode}]})

            if ((recent || []).length > 0) {
                components.push({
                    id: 'highlight_1',
                    component: 'CardHighlight',
                    prefix: '近30天收藏',
                    count: recent.length,
                    suffix: '条',
                    count2: totalCount,
                    suffix2: '条累计',
                })
                rootChildren.push('highlight_1')
                let items = await resolveFavTitles(recent, homeEndpoint)
                components.push({id: 'list_1', component: 'CardList', items})
                rootChildren.push('list_1')
            }
        }

        if (rootChildren.length === 0) {
            components.push({id: 'text_empty', component: 'CardText', content: '近30天暂无新收藏'})
            rootChildren.push('text_empty')
        }

        components.push({id: 'root', component: 'CardContent', children: rootChildren})
        return wrapA2uiCommands(surfaceId, components)
    } catch (error) {
        throw new Error(`获取资源收藏数据失败: ${error.message}`)
    }
}
