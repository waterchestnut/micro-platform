/**
 * @fileOverview 知识库材料分段相关的业务操作
 * @author xianyang
 * @module
 */

import ragSegmentDac from '../../daos/core/dac/ragSegmentDac.js'
import retSchema from '../../daos/retSchema.js'
import ragChunkDac from '../../daos/core/dac/ragChunkDac.js'
import {checkCodeField} from '../../tools/check.js'
import ragMaterialDac from '../../daos/core/dac/ragMaterialDac.js'
import {calcTextTokenCount} from '../openai/util.js'
import {sendMessage} from '../../daos/kafka/client.js'
import {text2Sents} from '../../grpc/clients/nlpAnalyzer.js'
import {deleteByQuery, upsertItems} from '../../daos/milvus/dac/chunkDac.js'
import {getContentVector} from '../openai/embedding.js'
import {updateChunkRagIndex} from './ragChunk.js'

const tools = rag.tools
const logger = rag.logger
const config = rag.config
const kafkaConfig = rag.config.kafka

/**
 * @description 获取材料分段列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 材料分段数组}
 */
export async function getRagSegments(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {position: 1, updateTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    let ret = await ragSegmentDac.getByPage(pageIndex, pageSize, optionsIn)

    if (options.withChunk && ret.rows?.length) {
        let ragSegmentCodes = ret.rows.map((row) => row.ragSegmentCode)
        let chunkList = await ragChunkDac.getTop(ragSegmentCodes.length * 100, {ragSegmentCode: ragSegmentCodes}, {position: 1})
        ret.rows.forEach((ragSegmentInfo) => {
            ragSegmentInfo.chunks = chunkList.filter(chunk => chunk.ragSegmentCode === ragSegmentInfo.ragSegmentCode)
        })
    }

    return ret
}

/**
 * @description 获取材料分段信息
 * @author xianyang
 * @param {String} ragSegmentCode 材料分段标识
 * @returns {Promise<Object>} 材料分段信息
 */
export async function getRagSegment(ragSegmentCode) {
    return ragSegmentDac.getByCode(ragSegmentCode)
}

/**
 * @description 添加材料分段
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {Object} ragSegmentInfo 材料分段
 * @returns {Promise<Object>} 添加成功时返回新添加的材料
 */
export async function addRagSegment(curUserInfo, ragSegmentInfo) {
    if (!ragSegmentInfo) {
        throw new Error('未传递材料数据')
    }
    if (!ragSegmentInfo.ragSegmentCode) {
        ragSegmentInfo.ragSegmentCode = tools.getUUID()
    }
    if (!ragSegmentInfo.content || !ragSegmentInfo.ragSegmentCode || !ragSegmentInfo.ragMaterialCode) {
        throw new Error('需要分段内容、分段标识和材料标识')
    }

    checkRagSegmentField(ragSegmentInfo)

    let oldRagSegment = await ragSegmentDac.getByCode(ragSegmentInfo.ragSegmentCode)
    if (oldRagSegment) {
        throw new Error('分段标识已存在')
    }

    let ragMaterialInfo = await ragMaterialDac.getByCode(ragSegmentInfo.ragMaterialCode)
    if (!ragMaterialInfo) {
        throw new Error('材料不存在')
    }

    let newRagSegment = {
        ...ragSegmentInfo,
        ragCode: ragSegmentInfo.ragCode,
        ragSegmentCode: ragSegmentInfo.ragSegmentCode,
        content: ragSegmentInfo.content,
        language: ragSegmentInfo.language,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
        usage: 0,
        tags: ragSegmentInfo.tags,
    }
    if (!newRagSegment.position) {
        let latestList = await ragSegmentDac.getTop(1, {ragMaterialCode: ragSegmentInfo.ragMaterialCode}, {position: -1})
        let latestPosition = 0
        if (latestList?.length) {
            latestPosition = latestList[0].position || 0
        }
        newRagSegment.position = latestPosition + 1
    }
    let ret = await ragSegmentDac.add(newRagSegment)

    /*触发材料的解析*/
    await updateText(ret.ragSegmentCode, ret.content)

    return ret
}

/**
 * @description 修改材料分段
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragSegmentCode 分段标识
 * @param {Object} newRagSegment 新的材料分段
 * @returns {Promise<Object>} 受影响的行数
 */
export async function updateRagSegment(curUserInfo, ragSegmentCode, newRagSegment) {
    if (!ragSegmentCode) {
        throw new Error('缺少分段标识')
    }
    if (!newRagSegment) {
        throw new Error('没有要更新的材料')
    }

    checkRagSegmentField(newRagSegment)

    let oldSegment = await ragSegmentDac.getByCode(ragSegmentCode)
    if (!oldSegment) {
        throw new Error('材料分段不存在')
    }

    let ragInfo = {
        ragSegmentCode,
        content: newRagSegment.content,
        language: newRagSegment.language,
        tags: newRagSegment.tags,
    }

    let ret = await ragSegmentDac.update(ragInfo)

    /*触发材料的解析*/
    if (newRagSegment.content && newRagSegment.content !== oldSegment.content) {
        await updateText(ragSegmentCode, newRagSegment.content)
    }

    return ret
}

/**
 * @description 删除材料分段
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragSegmentCode 分段标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteRagSegment(curUserInfo, ragSegmentCode) {
    if (!ragSegmentCode) {
        throw new Error('缺少分段标识')
    }

    //删除分句
    await ragChunkDac.update({status: -1}, {ragSegmentCode})
    await deleteByQuery({
        filter: `ragSegmentCode == '${ragSegmentCode}'`
    })

    return ragSegmentDac.update({ragSegmentCode, status: -1})
}

/**
 * @description 启用材料分段
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragSegmentCode 分段标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function enableRagSegment(curUserInfo, ragSegmentCode) {
    if (!ragSegmentCode) {
        throw new Error('缺少分段标识')
    }

    //启用分句
    await ragChunkDac.update({status: 0}, {ragSegmentCode, status: {$ne: -1}})
    let chunkList = await ragChunkDac.getTop(10000, {ragSegmentCode})
    await updateChunkRagIndex(chunkList)

    return ragSegmentDac.update({ragSegmentCode, status: 0})
}

/**
 * @description 禁用材料分段
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragSegmentCode 分段标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function disableRagSegment(curUserInfo, ragSegmentCode) {
    if (!ragSegmentCode) {
        throw new Error('缺少分段标识')
    }

    //禁用分句
    await ragChunkDac.update({status: 1}, {ragSegmentCode, status: {$ne: -1}})
    let chunkList = await ragChunkDac.getTop(10000, {ragSegmentCode})
    await updateChunkRagIndex(chunkList)

    return ragSegmentDac.update({ragSegmentCode, status: 1})
}

/**
 * @description 校验分段相关字段的合法性
 * @author menglb
 * @param {Object} ragSegmentInfo 分段信息
 * @returns {Boolean} 校验是否通过
 */
function checkRagSegmentField(ragSegmentInfo) {
    if (!ragSegmentInfo) {
        return true
    }
    checkCodeField(ragSegmentInfo.ragSegmentCode, '分段标识')
    if (ragSegmentInfo.content) {
        if (!/^.{10,1500}$/g.test(ragSegmentInfo.content)) {
            throw new Error('内容至少10个字符，且总长度不能超过1500个字符')
        }
    }
    return true
}

/*修改分段文本*/
export async function updateText(ragSegmentCode, text) {
    if (!text) {
        return 'none'
    }
    let segmentInfo = await ragSegmentDac.getByCode(ragSegmentCode)
    if (!segmentInfo) {
        return 'error'
    }
    segmentInfo.wordCount = text.length
    segmentInfo.tokens = calcTextTokenCount(text)
    segmentInfo.handleStatus = 0
    let ret = await ragSegmentDac.update({
        ragSegmentCode,
        wordCount: segmentInfo.wordCount,
        tokens: segmentInfo.tokens,
        handleStatus: 0
    })

    /*加入解析队列*/
    await sendMessage([{
        topic: kafkaConfig.topics.ragSegment.topic,
        key: segmentInfo.ragSegmentCode,
        value: JSON.stringify(segmentInfo)
    }])

    return 'done'
}

/**
 * @description 解析处理材料分段（重新分句和索引）
 * @author menglb
 * @param {Object} segmentInfo 材料片段
 * @returns {Promise<String>} 处理结果
 */
export async function handleSimpleSegment(segmentInfo) {
    if (segmentInfo?.handleStatus !== 0 || !segmentInfo?.content?.length) {
        return 'none'
    }
    try {
        await ragSegmentDac.updateById({
            _id: segmentInfo._id,
            handleStatus: 1, handleError: '解析处理中'
        })

        let chunkList = await nlpChunk(segmentInfo)
        /*清理现有的分句*/
        await ragChunkDac.destroyByFilter({ragSegmentCode: segmentInfo.ragSegmentCode})
        await deleteByQuery({
            filter: `ragSegmentCode == '${segmentInfo.ragSegmentCode}'`
        })
        /*插入新的分句信息*/
        if (chunkList.length) {
            await ragChunkDac.bulkUpdate(chunkList)
            await updateChunkRagIndex(chunkList)
        }

        await ragSegmentDac.updateById({
            _id: segmentInfo._id,
            usage: 1,
            handleStatus: 2, handleError: '解析完成'
        })
        return 'done'
    } catch (err) {
        await ragSegmentDac.updateById({
            _id: segmentInfo._id,
            handleStatus: -1,
            handleError: `${err}`,
        })
        return 'error'
    }
}

/*自然语言模型分句*/
async function nlpChunk(segmentInfo) {
    let sents = (await text2Sents(segmentInfo.content, segmentInfo.language))?.sents || []
    let chunkLength = 256
    let chunks = []
    if (!sents.length) {
        return chunks
    }

    let chunkContent = ''
    let position = 1

    function pushChunk() {
        chunks.push({
            ragChunkCode: tools.getUUID(),
            ragCode: segmentInfo.ragCode,
            ragMaterialCode: segmentInfo.ragMaterialCode,
            ragSegmentCode: segmentInfo.ragSegmentCode,
            content: chunkContent,
            position,
            wordCount: chunkContent.length,
            language: segmentInfo.language,
            operator: segmentInfo.operator,
            usage: 1,
            status: 0
        })
    }

    sents.forEach(sent => {
        chunkContent = chunkContent ? chunkContent + ' ' + sent : sent
        if (chunkContent.length < chunkLength) {
            return
        }
        pushChunk()
        chunkContent = ''
        position += 1
    })
    if (chunkContent) {
        pushChunk()
    }

    return chunks
}