/**
 * @fileOverview 知识库材料相关的业务操作
 * @author xianyang
 * @module
 */

import ragMaterialDac from '../../daos/core/dac/ragMaterialDac.js'
import retSchema from '../../daos/retSchema.js'
import {readFile} from 'node:fs/promises'
import {excel2Text, html2Text, pdf2Text, word2Text} from '../../grpc/clients/extractor.js'
import ragInfoDac from '../../daos/core/dac/ragInfoDac.js'
import {checkCodeField} from '../../tools/check.js'
import ragSegmentDac from '../../daos/core/dac/ragSegmentDac.js'
import ragChunkDac from '../../daos/core/dac/ragChunkDac.js'
import {sendMessage} from '../../daos/kafka/client.js'
import {detectLanguage, translate2ZH} from '../translate.js'
import {text2Sents} from '../../grpc/clients/nlpAnalyzer.js'
import {calcTextTokenCount} from '../openai/util.js'
import {deleteByQuery, upsertItems} from '../../daos/milvus/dac/chunkDac.js'
import {getContentVector} from '../openai/embedding.js'
import {updateChunkRagIndex} from './ragChunk.js'
import {addRagInfo} from './ragInfo.js'

const tools = rag.tools
const logger = rag.logger
const config = rag.config
const kafkaConfig = rag.config.kafka

/**
 * @description 获取知识库材料列表
 * @author xianyang
 * @param {Object} [filter] 筛选条件
 * @param {Number} [pageIndex=1] 页码
 * @param {Number} [pageSize=10] 分页大小
 * @param {Object} [options] 排序、格式化等参数
 * @param {Number} [options.total] 记录的总数（翻页时可省略总数的查询）
 * @param {{[key: string]:1 | -1}} [options.sort] 排序
 * @returns {Promise<{total: Number, rows: [Object]}>} {total: 总数, rows: 知识库材料数组}
 */
export async function getRagMaterials(filter = {}, pageIndex = 1, pageSize = 10, options = {}) {
    let optionsIn = {...filter}
    if (options.sort) {
        optionsIn.sort = options.sort
    } else {
        optionsIn.sort = {updateTime: -1}
    }
    if (options.total) {
        optionsIn.total = options.total
    }
    return ragMaterialDac.getByPage(pageIndex, pageSize, optionsIn)
}

/**
 * @description 获取材料信息
 * @author xianyang
 * @param {String} ragMaterialCode 材料标识
 * @returns {Promise<Object>} 材料信息
 */
export async function getRagMaterial(ragMaterialCode) {
    return ragMaterialDac.getByCode(ragMaterialCode)
}

/**
 * @description 添加知识库材料
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {Object} ragMaterialInfo 知识库材料
 * @returns {Promise<Object>} 添加成功时返回新添加的材料
 */
export async function addRagMaterial(curUserInfo, ragMaterialInfo) {
    if (!ragMaterialInfo) {
        throw new Error('未传递材料数据')
    }
    if (!ragMaterialInfo.ragMaterialCode) {
        ragMaterialInfo.ragMaterialCode = tools.getUUID()
    }
    if (!ragMaterialInfo.resTitle || !ragMaterialInfo.ragMaterialCode || !ragMaterialInfo.ragCode) {
        throw new Error('需要材料标题、材料标识和知识库标识')
    }

    checkRagMaterialField(ragMaterialInfo)

    let oldRagMaterial = await ragMaterialDac.getByCode(ragMaterialInfo.ragMaterialCode)
    if (oldRagMaterial) {
        throw new Error('材料标识已存在')
    }

    let ragInfo = await ragInfoDac.getByCode(ragMaterialInfo.ragCode)
    if (!ragInfo) {
        throw new Error('知识库不存在')
    }

    let newRagMaterial = {
        ...ragMaterialInfo,
        ragCode: ragMaterialInfo.ragCode,
        ragMaterialCode: ragMaterialInfo.ragMaterialCode,
        resTitle: ragMaterialInfo.resTitle,
        description: ragMaterialInfo.description,
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        status: 0,
        usage: 0,
        handleStatus: 0,
        tags: ragMaterialInfo.tags,
        ragType: ragInfo.ragType,
    }
    let ret = await ragMaterialDac.add(newRagMaterial)

    /*加入材料队列*/
    await sendMessage([{
        topic: kafkaConfig.topics.ragMaterial.topic, key: ret.ragMaterialCode, value: JSON.stringify(ret)
    }])

    return ret
}

/**
 * @description 修改知识库材料
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragMaterialCode 材料标识
 * @param {Object} newRagMaterial 新的知识库材料
 * @returns {Promise<Object>} 受影响的行数
 */
export async function updateRagMaterial(curUserInfo, ragMaterialCode, newRagMaterial) {
    if (!ragMaterialCode) {
        throw new Error('缺少材料标识')
    }
    if (!newRagMaterial) {
        throw new Error('没有要更新的材料')
    }

    checkRagMaterialField(newRagMaterial)

    let ragInfo = {
        ragMaterialCode,
        resTitle: newRagMaterial.resTitle,
        description: newRagMaterial.description,
        tags: newRagMaterial.tags,
        metas: newRagMaterial.metas,
        resOriginalUrl: newRagMaterial.resOriginalUrl,
        resCode: newRagMaterial.resCode,
    }

    let ret = await ragMaterialDac.update(ragInfo)

    /*加入材料队列*/
    let ragMaterialInfo = await ragMaterialDac.getByCode(ragMaterialCode)
    await sendMessage([{
        topic: kafkaConfig.topics.ragMaterial.topic,
        key: ragMaterialInfo.ragMaterialCode,
        value: JSON.stringify(ragMaterialInfo)
    }])

    return ret
}

/**
 * @description 删除知识库材料
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragMaterialCode 材料标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function deleteRagMaterial(curUserInfo, ragMaterialCode) {
    if (!ragMaterialCode) {
        throw new Error('缺少材料标识')
    }

    //删除分段分句
    await ragSegmentDac.update({status: -1}, {ragMaterialCode})
    await ragChunkDac.update({status: -1}, {ragMaterialCode})
    await deleteByQuery({
        filter: `ragMaterialCode == '${ragMaterialCode}'`
    })

    return ragMaterialDac.update({ragMaterialCode, status: -1})
}

/**
 * @description 启用知识库材料
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragMaterialCode 材料标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function enableRagMaterial(curUserInfo, ragMaterialCode) {
    if (!ragMaterialCode) {
        throw new Error('缺少材料标识')
    }

    //启用分段分句
    await ragSegmentDac.update({status: 0}, {ragMaterialCode, status: {$ne: -1}})
    await ragChunkDac.update({status: 0}, {ragMaterialCode, status: {$ne: -1}})
    let chunkList = await ragChunkDac.getTop(10000, {ragMaterialCode})
    await updateChunkRagIndex(chunkList)

    return ragMaterialDac.update({ragMaterialCode, status: 0})
}

/**
 * @description 禁用知识库材料
 * @author menglb
 * @param {Object} curUserInfo 当前用户
 * @param {String} ragMaterialCode 材料标识
 * @returns {Promise<Object>} 受影响的行数
 */
export async function disableRagMaterial(curUserInfo, ragMaterialCode) {
    if (!ragMaterialCode) {
        throw new Error('缺少材料标识')
    }

    //禁用分段分句
    await ragSegmentDac.update({status: 1}, {ragMaterialCode, status: {$ne: -1}})
    await ragChunkDac.update({status: 1}, {ragMaterialCode, status: {$ne: -1}})
    let chunkList = await ragChunkDac.getTop(10000, {ragMaterialCode})
    await updateChunkRagIndex(chunkList)

    return ragMaterialDac.update({ragMaterialCode, status: 1})
}

/**
 * @description 校验材料相关字段的合法性
 * @author menglb
 * @param {Object} ragMaterialInfo 材料信息
 * @returns {Boolean} 校验是否通过
 */
function checkRagMaterialField(ragMaterialInfo) {
    if (!ragMaterialInfo) {
        return true
    }
    checkCodeField(ragMaterialInfo.ragMaterialCode, '材料标识')
    if (ragMaterialInfo.resTitle) {
        if (!/^.{2,512}$/g.test(ragMaterialInfo.resTitle)) {
            throw new Error('标题至少2个字符，且总长度不能超过512个字符')
        }
    }
    return true
}

/*临时提前文本验证*/
export async function getTextTest() {
    const data = await readFile('F:\\数据公司数据\\pdf\\002\\593\\018\\00002593018.pdf')
    const text = await pdf2Text(Uint8Array.from(data), 'en')
    console.log(text)
}

/**
 * @description 解析处理单份材料（文本提取、文本分段、翻译、索引等）
 * @author menglb
 * @param {Object} materialInfo 材料信息对像
 * @returns {Promise<String>} 处理结果
 */
export async function handleSimpleMaterial(materialInfo) {
    if (materialInfo?.handleStatus !== 0 || !materialInfo?.fileList?.length) {
        return 'none'
    }

    let ragInfo = await ragInfoDac.getByCode(materialInfo.ragCode)

    let fileInfo = materialInfo.fileList[0]
    if (!['pdf', 'doc', 'docx', 'xls', 'xlsx', 'html', 'txt'].includes(fileInfo.fileExt)) {
        await ragMaterialDac.updateById({
            _id: materialInfo._id, handleStatus: -1, handleError: '不支持的文件格式'
        })
        return 'error'
    }
    await ragMaterialDac.updateById({
        _id: materialInfo._id, handleStatus: 1, handleError: '解析处理中'
    })
    try {
        let text = await getFileText(fileInfo)
        if (!text) {
            await ragMaterialDac.updateById({
                _id: materialInfo._id, handleStatus: -1, handleError: '未解析到文本内容'
            })
            return 'error'
        }
        let language = await detectLanguage(text.substring(0, 1023))
        let originalDetail = {
            isOriginal: 1,
            language: language,
            text: text,
            wordCount: text.length,
            tokens: calcTextTokenCount(text),
            fileCode: fileInfo.fileCode,
        }
        let ret = await nlpChunk(materialInfo.ragCode, materialInfo, originalDetail, materialInfo.operator, ragInfo)
        /*清理现有的分段、分句*/
        await ragSegmentDac.destroyByFilter({ragMaterialCode: materialInfo.ragMaterialCode})
        await ragChunkDac.destroyByFilter({ragMaterialCode: materialInfo.ragMaterialCode})
        await deleteByQuery({
            filter: `ragMaterialCode == '${materialInfo.ragMaterialCode}'`
        })
        /*插入新的分段、分句信息*/
        let segList = ret.segments.concat(ret.zhSegments)
        let chunkList = ret.chunks.concat(ret.zhChunks)
        if (segList.length) {
            await ragSegmentDac.bulkUpdate(segList)
        }
        if (chunkList.length) {
            await ragChunkDac.bulkUpdate(chunkList)
            await updateChunkRagIndex(chunkList)
        }

        let details = [originalDetail]
        if (ret.zhSegments.length) {
            let wordCount = 0
            let tokens = 0
            ret.zhSegments.forEach((_, i) => {
                wordCount += _.wordCount
                tokens += _.tokens
            })
            details.push({
                isOriginal: 0,
                language: 'zh-Hans',
                text: '',
                wordCount,
                tokens,
                fileCode: fileInfo.fileCode,
            })
        }
        await ragMaterialDac.updateById({
            _id: materialInfo._id,
            usage: 1,
            details,
            handleStatus: 2, handleError: '解析完成'
        })
        return 'done'
    } catch (err) {
        await ragMaterialDac.updateById({
            handleStatus: -1,
            handleError: `${err}`,
            _id: materialInfo._id,
        })
        return 'error'
    }
}

/*调用接口提取文本*/
async function getFileText(fileInfo) {
    let url = `${config.docConfig.baseIntranetUrl}/file/download/?fileCode=${fileInfo.fileCode}`
    const fileRes = await fetch(url)
    let text = ''
    if (['pdf'].includes(fileInfo.fileExt)) {
        text = await pdf2Text(new Uint8Array(await fileRes.arrayBuffer()), 'en')
    } else if (['doc', 'docx'].includes(fileInfo.fileExt)) {
        text = await word2Text(new Uint8Array(await fileRes.arrayBuffer()), 'en')
    } else if (['xls', 'xlsx'].includes(fileInfo.fileExt)) {
        text = await excel2Text(new Uint8Array(await fileRes.arrayBuffer()), fileInfo.fileExt)
    } else if (['html'].includes(fileInfo.fileExt)) {
        text = html2Text(new Uint8Array(await fileRes.arrayBuffer()), 'en')
    } else {
        text = await fileRes.text()
    }

    return text
}

/*自然语言模型分段分句*/
export async function nlpChunk(ragCode, materialInfo, originalDetail, operator, ragInfo = {}) {
    let segLength = 1024
    let chunkLength = 256
    let segments = []
    let chunks = []
    let zhSegments = []
    let zhChunks = []
    let pList = originalDetail.text.split('\n\n')
    for (let i = 0; i < pList.length; i++) {
        let pText = pList[i].trim()
        if (!pText) {
            continue
        }
        pText = pText.replace(/\s+/ig, ' ')
        let start = 0
        let segText = pText.substr(start, parseInt(segLength * 1.1))
        while (segText) {
            let sents = (await text2Sents(segText, originalDetail.language))?.sents || []
            if (sents.length > 0) {
                let ragSegmentCode = tools.getUUID()
                let content = sents.join(' ')
                segments.push({
                    ragSegmentCode,
                    ragCode,
                    ragMaterialCode: materialInfo.ragMaterialCode,
                    content,
                    position: segments.length + 1,
                    wordCount: content.length,
                    tokens: calcTextTokenCount(content),
                    language: originalDetail.language,
                    operator: operator || {
                        userCode: 'union',
                        realName: '联盟'
                    },
                    status: 0,
                    usage: 1,
                    handleStatus: 2,
                    tags: [],
                })
                let chunkContent = ''
                let position = 1

                function pushChunk() {
                    chunks.push({
                        ragChunkCode: tools.getUUID(),
                        ragCode: ragCode,
                        ragMaterialCode: materialInfo.ragMaterialCode,
                        ragSegmentCode,
                        content: chunkContent,
                        position,
                        wordCount: chunkContent.length,
                        language: originalDetail.language,
                        operator: operator || {
                            userCode: 'union',
                            realName: '联盟'
                        },
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
            }

            if (ragInfo.needTrans === 1 && sents.length > 0 && originalDetail.language !== 'zh-Hans') {
                /*翻译为中文*/
                let zhSegText = await translate2ZH(sents.join(' '), originalDetail.language)
                if (zhSegText) {
                    let zhSents = (await text2Sents(zhSegText, 'zh-Hans'))?.sents || []
                    //console.log(sents, zhSents)
                    if (zhSents.length > 0) {
                        let ragSegmentCode = tools.getUUID()
                        let content = zhSents.join(' ')
                        zhSegments.push({
                            ragSegmentCode,
                            ragCode,
                            ragMaterialCode: materialInfo.ragMaterialCode,
                            content,
                            position: zhSegments.length + 1,
                            wordCount: content.length,
                            tokens: calcTextTokenCount(content),
                            language: 'zh-Hans',
                            operator: operator || {
                                userCode: 'union',
                                realName: '联盟'
                            },
                            status: 0,
                            usage: 1,
                            handleStatus: 2,
                            tags: [],
                        })
                        let chunkContent = ''
                        let position = 1

                        function pushZhChunk() {
                            zhChunks.push({
                                ragChunkCode: tools.getUUID(),
                                ragCode: ragCode,
                                ragMaterialCode: materialInfo.ragMaterialCode,
                                ragSegmentCode,
                                content: chunkContent,
                                position,
                                wordCount: chunkContent.length,
                                language: 'zh-Hans',
                                operator: operator || {
                                    userCode: 'union',
                                    realName: '联盟'
                                },
                                usage: 1,
                                status: 0
                            })
                        }

                        zhSents.forEach(sent => {
                            chunkContent = chunkContent ? chunkContent + ' ' + sent : sent
                            if (chunkContent.length < chunkLength) {
                                return
                            }
                            pushZhChunk()
                            chunkContent = ''
                            position += 1
                        })
                        if (chunkContent) {
                            pushZhChunk()
                        }
                    }
                }
            }

            start += segLength
            segText = pText.substr(start, parseInt(segLength * 1.1))
        }
    }

    return {
        segments, chunks, zhSegments, zhChunks
    }
}

/*材料核验，已经存在的材料则检查RAG的状态，不存在的材料则添加为新材料*/
export async function checkRagMaterial(curUserInfo, toCheckRagInfo, toCheckMaterialInfo) {
    if (!toCheckRagInfo.ragCode || !toCheckMaterialInfo.ragMaterialCode || toCheckRagInfo.ragCode !== toCheckMaterialInfo.ragCode) {
        throw new Error('材料信息传递不完整，无法核验')
    }

    let ragInfo = await ragInfoDac.getByCode(toCheckRagInfo.ragCode)
    if (!ragInfo) {
        ragInfo = await addRagInfo(curUserInfo, {title: '未命名知识库', ...toCheckRagInfo}, 1)
    }
    let materialInfo = await ragMaterialDac.getByCode(toCheckMaterialInfo.ragMaterialCode)
    if (!materialInfo) {
        materialInfo = await addRagMaterial(curUserInfo, {
            resTitle: '未命名材料', ...toCheckMaterialInfo,
            ragType: ragInfo.ragType
        })
    }

    return materialInfo
}