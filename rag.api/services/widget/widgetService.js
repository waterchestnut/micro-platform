/**
 * @fileOverview 桌面小组件内容相关的业务操作
 * @module
 */

import ragInfoDac from '../../daos/core/dac/ragInfoDac.js'
import ragOperationLogDac from '../../daos/core/dac/ragOperationLogDac.js'
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
 * @description 知识库小组件内容：我拥有的知识库数与近7天动态
 * @param {Object} curUserInfo 当前登录用户
 * @returns {Promise<Array>} A2UI 命令数组
 */
export async function getRagWidget(curUserInfo, surfaceId, homeEndpoint) {
    try {
        let myUserCode = curUserInfo?.userCode
        let items = []

        if (myUserCode) {
            let myRags = await ragInfoDac.getTop(20, {status: 0, complexFilter: [{'operator.userCode': myUserCode}]}, {insertTime: -1})
            if ((myRags || []).length > 0) {
                items.push({text: `我拥有 ${myRags.length} 个知识库`, status: 'default'})
                let ragCodes = myRags.map(r => r.ragCode).filter(Boolean)
                let since = new Date(Date.now() - 7 * DAY_MS)
                let logs = await ragOperationLogDac.getTop(2, {complexFilter: [{ragCode: {$in: ragCodes}}, {insertTime: {$gte: since}}]}, {insertTime: -1})
                for (let log of (logs || [])) {
                    items.push({text: `【${log.description || log.logType || '动态'}】${log.targetMaterialTitle || ''}`.trim(), status: 'success', url: clientJumpUrl('rag', `/rag/detail/${log.ragCode || ''}`, homeEndpoint)})
                }
                if ((logs || []).length === 0) {
                    items.push({text: `【${myRags[0].title || '知识库'}】近7天暂无新动态`, status: 'default'})
                }
            }
        }

        if (items.length === 0) {
            items.push({text: '暂无知识库', status: 'default'})
        }

        let components = [
            {id: 'list_1', component: 'CardList', items},
            {id: 'root', component: 'CardContent', children: ['list_1']},
        ]
        return wrapA2uiCommands(surfaceId, components)
    } catch (error) {
        throw new Error(`获取知识库数据失败: ${error.message}`)
    }
}
