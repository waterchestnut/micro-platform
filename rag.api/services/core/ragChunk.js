/**
 * @fileOverview 知识库材料分句相关的业务操作
 * @author xianyang
 * @module
 */

import ragChunkDac from '../../daos/core/dac/ragChunkDac.js'
import retSchema from '../../daos/retSchema.js'
import {checkCodeField} from '../../tools/check.js'
import ragSegmentDac from '../../daos/core/dac/ragSegmentDac.js'
import {getContentVector} from '../openai/embedding.js'
import {deleteByQuery, upsertItems} from '../../daos/milvus/dac/chunkDac.js'

const tools = rag.tools
const logger = rag.logger
const config = rag.config

/**
 * @description 获取材料分句列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 材料分句数组}
 */
export async function getRagChunks(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {updateTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return ragChunkDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 获取材料分句信息
 * @author xianyang
 * @param {String} ragChunkCode 材料分句标识
 * @returns {Promise<Object>} 材料分句信息
 */
export async function getRagChunk(ragChunkCode) {
    return ragChunkDac.getByCode(ragChunkCode)
}

/**
 * @description 添加材料分句
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {Object} ragChunkInfo 材料分句
 * @returns {Promise<Object>} 添加成功时返回新添加的材料
 */
export async function addRagChunk(curUserInfo, ragChunkInfo) {
    if (!ragChunkInfo) {
        throw new Error('未传递材料数据')
    }
    if (!ragChunkInfo.ragChunkCode) {
        ragChunkInfo.ragChunkCode = tools.getUUID()
    }
    if (!ragChunkInfo.content || !ragChunkInfo.ragChunkCode || !ragChunkInfo.ragSegmentCode) {
        throw new Error('需要分句内容、分句标识和分段标识')
    }

    checkRagChunkField(ragChunkInfo)

    let oldRagChunk = await ragChunkDac.getByCode(ragChunkInfo.ragChunkCode)
    if (oldRagChunk) {
        throw new Error('分句标识已存在')
    }

    let ragSegmentInfo = await ragSegmentDac.getByCode(ragChunkInfo.ragSegmentCode)
    if (!ragSegmentInfo) {
        throw new Error('分段不存在')
    }

    let newRagChunk = {
        ...ragChunkInfo,
        ragCode: ragChunkInfo.ragCode,
        ragChunkCode: ragChunkInfo.ragChunkCode,
        content: ragChunkInfo.content,
        language: ragChunkInfo.language,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
        usage: 0,
        tags: ragChunkInfo.tags,
        ragMaterialCode: ragSegmentInfo.ragMaterialCode,
    }
    if (!newRagChunk.position) {
        let latestList = await ragChunkDac.getTop(1, {ragSegmentCode: ragSegmentInfo.ragSegmentCode}, {position: -1})
        let latestPosition = 0
        if (latestList?.length) {
            latestPosition = latestList[0].position || 0
        }
        newRagChunk.position = latestPosition + 1
    }
    let ret = await ragChunkDac.add(newRagChunk)

    /*触发材料的解析*/
    await updateText(ret.ragChunkCode, ret.content)

    return ret
}

/**
 * @description 修改材料分句
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragChunkCode 分句标识
 * @param {Object} newRagChunk 新的材料分句
 * @returns {Promise<Object>} 受影响的行数
 */
export async function updateRagChunk(curUserInfo, ragChunkCode, newRagChunk) {
    if (!ragChunkCode) {
        throw new Error('缺少分句标识')
    }
    if (!newRagChunk) {
        throw new Error('没有要更新的材料')
    }

    checkRagChunkField(newRagChunk)

    let oldChunk = await ragChunkDac.getByCode(ragChunkCode)
    if (!oldChunk) {
        throw new Error('分句不存在')
    }

    let ragInfo = {
        ragChunkCode,
        content: newRagChunk.content,
        language: newRagChunk.language,
        tags: newRagChunk.tags,
    }

    let ret = await ragChunkDac.update(ragInfo)

    /*触发材料的解析*/
    if (newRagChunk.content && newRagChunk.content !== oldChunk.content) {
        await updateText(ragChunkCode, newRagChunk.content)
    }

    return ret
}

/**
 * @description 删除材料分句
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragChunkCode 分句标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteRagChunk(curUserInfo, ragChunkCode) {
    if (!ragChunkCode) {
        throw new Error('缺少分句标识')
    }

    let ret = await ragChunkDac.update({ragChunkCode, status: -1})
    await deleteByQuery({
        ids: [ragChunkCode]
    })

    return ret
}

/**
 * @description 启用材料分句
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragChunkCode 分句标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function enableRagChunk(curUserInfo, ragChunkCode) {
    if (!ragChunkCode) {
        throw new Error('缺少分句标识')
    }

    let ret = await ragChunkDac.update({ragChunkCode, status: 0})
    let chunkList = await ragChunkDac.getTop(10000, {ragChunkCode})
    await updateChunkRagIndex(chunkList)
    return ret
}

/**
 * @description 禁用材料分句
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragChunkCode 分句标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function disableRagChunk(curUserInfo, ragChunkCode) {
    if (!ragChunkCode) {
        throw new Error('缺少分句标识')
    }

    let ret = await ragChunkDac.update({ragChunkCode, status: 1})
    let chunkList = await ragChunkDac.getTop(10000, {ragChunkCode})
    await updateChunkRagIndex(chunkList)
    return ret
}

/**
 * @description 校验分句相关字段的合法性
 * @author menglb
 * @param {Object} ragChunkInfo 分句信息
 * @returns {Boolean} 校验是否通过
 */
function checkRagChunkField(ragChunkInfo) {
    if (!ragChunkInfo) {
        return true
    }
    checkCodeField(ragChunkInfo.ragChunkCode, '分句标识')
    if (ragChunkInfo.content) {
        if (!/^.{10,500}$/g.test(ragChunkInfo.content)) {
            throw new Error('内容至少10个字符，且总长度不能超过500个字符')
        }
    }
    return true
}

/*修改分句文本*/
export async function updateText(ragChunkCode, text) {
    if (!text) {
        return 'none'
    }
    let chunkInfo = await ragChunkDac.getByCode(ragChunkCode)
    if (!chunkInfo) {
        return 'error'
    }
    let ret = await ragChunkDac.update({ragChunkCode, content: text, wordCount: text.length})
    await updateChunkRagIndex([chunkInfo])
    return 'done'
}

/**
 * @description 更新知识库索引
 * @author menglb
 * @param {Object[]} chunkList 分句列表
 * @param {boolean} [notUpdateVector=false] 不更新文本向量
 * @returns {Promise<Number>} 更新的条目数量
 */
export async function updateChunkRagIndex(chunkList, notUpdateVector = false) {
    let vectors = notUpdateVector ? [] : (await getContentVector(chunkList.map(_ => _.content)))
    let items = []
    chunkList.forEach((chunkInfo, i) => {
        let item = {
            ragChunkCode: chunkInfo.ragChunkCode,
            ragCode: chunkInfo.ragCode,
            ragMaterialCode: chunkInfo.ragMaterialCode,
            ragSegmentCode: chunkInfo.ragSegmentCode,
            language: chunkInfo.language,
            status: chunkInfo.status
        }
        if (vectors[i]) {
            item.content = vectors[i]
        }
        items.push(item)
    })
    return await upsertItems(items)
}