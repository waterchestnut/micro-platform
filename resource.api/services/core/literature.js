/**
 * @fileOverview 文献阅读相关的业务操作
 * @author xianyang 2025/11/13
 * @module
 */

import resInfoDac from '../../daos/core/dac/resInfoDac.js'
import retSchema from '../../daos/retSchema.js'
import {copyFile} from '../../grpc/clients/fileManage.js'
import {checkMaterial} from '../../grpc/clients/ragManage.js'
import {OpenAI} from 'openai'
import {excel2Text, html2Text, pdf2Text, word2Text} from '../../grpc/clients/extractor.js'

const tools = resource.tools
const logger = resource.logger
const config = resource.config

/*文献阅读的知识库标识*/
const ragCode = 'literature-shared'
/*文献阅读的知识库类型*/
const ragType = 'builtIn'
/*文献阅读的知识库标题*/
const ragTitle = '内置文献阅读知识库'
/*文献阅读的大模型会话频道*/
const llmChannel = 'pdfviewer-literature'

/*检查文献阅读数据的准备情况*/
export async function checkLiterature(curUserInfo, originalResCode) {
    /*@todo 需要兼容资源来至联盟资源库的情况*/
    let originalResInfo = await resInfoDac.getByCode(originalResCode)
    if (!originalResInfo) {
        throw new Error('文献不存在')
    }

    let literatureResInfo = null
    if (originalResInfo.operator?.userCode === curUserInfo.userCode && originalResInfo.manageTypes.includes('literature')) {
        literatureResInfo = originalResInfo
    } else {
        literatureResInfo = await resInfoDac.getOneByFilter({
            'operator.userCode': curUserInfo.userCode,
            manageTypes: 'literature',
            originalResCode: originalResInfo.originalResCode || originalResInfo.resCode
        })
    }
    if (literatureResInfo && !literatureResInfo.originalHashCode) {
        throw new Error('材料加工出错，无法定位材料文件')
    }
    if (!literatureResInfo) {
        /*复制一份文献到当前用户自己的空间*/
        let resCode = tools.getUUID()
        let fileList = await copyResFileList(originalResInfo, curUserInfo)
        let originalHashCode = originalResInfo.originalHashCode || originalResInfo.fileHashCodes?.[0]
        let resInfo = {
            resCode,
            title: originalResInfo.title,
            author: originalResInfo.author,
            abstract: originalResInfo.abstract,
            publisher: originalResInfo.publisher,
            publishDate: originalResInfo.publishDate,
            resType: originalResInfo.resType,
            coverUrl: originalResInfo.coverUrl,
            tags: originalResInfo.tags,
            ragStatus: originalResInfo.ragStatus || 0,
            sources: [
                {
                    title: '文献解读标注存储',
                    description: '',
                    href: `/res/detail?resCode=${resCode}`,
                    sourceKey: 'literature-viewer',
                    openAccess: true
                }
            ],
            url: `/res/detail?resCode=${resCode}`,
            keywords: originalResInfo.keywords,
            fileList,
            fileHashCodes: fileList.map(_ => _.fileHashCode),
            fileExts: fileList.map(_ => _.fileExt),
            originalHashCode,
            manageTypes: ['literature'],
            operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
            llmChannelGroup: resCode,
            ragMaterialCode: originalResInfo.ragMaterialCode || `literature-${originalHashCode}`,
            originalResCode: originalResInfo.originalResCode || originalResInfo.resCode
        }

        literatureResInfo = (await resInfoDac.upsert(resInfo)).toObject()
    }
    let ragMaterialCode = literatureResInfo.ragMaterialCode || `literature-${literatureResInfo.originalHashCode}`
    const ragMaterialInfo = await checkMaterial(curUserInfo, ragCode, ragType, {ragCode, title: ragTitle}, {
        ragCode,
        ragMaterialCode,
        resTitle: originalResInfo.title || originalResInfo.fileList?.[0].name,
        resCode: originalResInfo.resCode,
        resOriginalUrl: originalResInfo.url,
        fileList: originalResInfo.fileList
    })
    /*console.log(ragMaterialInfo)*/
    resInfoDac.update({
        resCode: literatureResInfo.resCode,
        ragStatus: ragMaterialInfo.handleStatus,
        ragMaterialCode,
        llmChannel,
        latestReadTime: new Date()
    })

    return {
        ...literatureResInfo,
        ragStatus: ragMaterialInfo.handleStatus,
        ragMaterialCode
    }
}

/*复制资源的物理文件*/
async function copyResFileList(resInfo, curUserInfo) {
    let fileList = []
    if (!resInfo.fileList?.length) {
        return fileList
    }
    for (let i = 0; i < resInfo.fileList.length; i++) {
        let originalFileCode = resInfo.fileList[i].fileCode
        let fileInfo = await copyFile(curUserInfo, originalFileCode, {storeType: 'unique'}, 'literature')

        fileInfo.url = `?fileCode=${fileInfo.fileCode}`
        fileInfo.name = fileInfo.fileName
        fileInfo.size = fileInfo.fileSize
        fileInfo.type = fileInfo.mimetype
        fileList.push(fileInfo)
    }
    return fileList
}

/*本地文件上传后进行文献解读*/
export async function localFileLiterature(curUserInfo, fileInfo) {
    let metas = {}
    try {
        metas = await extractMetasFromFile(fileInfo)
    } catch (err) {
        logger.error(`提取文件元数据出错：${err}`)
    }
    let resCode = tools.getUUID()
    let title = metas['标题'] || fileInfo.name
    let author = metas['作者'] || []
    let abstract = metas['摘要'] || ''
    let publisher = metas['出版社'] || ''
    let publishDate = metas['出版时间'] || ''
    let keywords = metas['关键词'] || []
    let resInfo = {
        resCode,
        title,
        author,
        abstract,
        publisher,
        publishDate,
        keywords,
        resType: 'upload',
        ragStatus: 0,
        sources: [
            {
                title: '文献解读标注存储',
                description: '',
                href: `/res/detail?resCode=${resCode}`,
                sourceKey: 'literature-viewer',
                openAccess: true
            }
        ],
        url: `/res/detail?resCode=${resCode}`,
        fileList: [fileInfo],
        fileHashCodes: [fileInfo.fileHashCode],
        fileExts: [fileInfo.fileExt],
        originalHashCode: fileInfo.fileHashCode,
        manageTypes: ['literature'],
        operator: {userCode: curUserInfo.userCode, realName: curUserInfo.realName},
        llmChannelGroup: resCode,
        ragMaterialCode: `literature-${fileInfo.fileHashCode}`,
        originalResCode: resCode
    }
    return (await resInfoDac.upsert(resInfo)).toObject()
}

/*资源文件的元数据提取*/
async function extractMetasFromFile(fileInfo) {
    let text = await getFileText(fileInfo)
    if (!text) {
        return text
    }

    let llmConfig = config.metaExtractLLMConfig
    const openai = new OpenAI({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
    })
    const sysPrompt = `
        ## 定位
        - 角色：论文元数据提取专家
        - 任务：根据输入的论文文本，提取出论文的元数据，元数据字段包括标题、作者、出版社、出版时间、摘要、关键词
        
        ## 输出要求
        - 以JSON的格式返回提取的论文元数据字段
        - 标题、出版社、出版时间、摘要返回字符串类型
        - 关键词、作者返回字符串数组类型
        - 摘要最多返回1000个字
        - 没有提取到的字段不返回字段的键值
        - 没有提取到任何元数据时直接返回空字符串
        - 请严格遵守上述文本字数等要求
        `
    const examplePromptJson = `
        ## 输出样例（参考输出样例返回JSON格式的数据，无需额外解释）：
        {
          "标题": "标题",
          "作者": [
            "作者1",
            "作者2",
          ],
          "出版社": "出版社",
          "出版时间": "出版时间",
          "摘要": "摘要摘要摘要摘要",
          "关键词": [
            "关键词1",
            "关键词2",
          ]
        }
        `
    const userPrompt = `
    ## 输入论文文本： \n
    ${text.substring(0, 3000)}
    `
    let ret = await openai.chat.completions.create(
        {
            model: 'qwen3',
            messages: [
                {
                    'role': 'system',
                    'content': sysPrompt
                },
                {
                    'role': 'user',
                    'content': examplePromptJson,
                },
                {
                    'role': 'user',
                    'content': userPrompt,
                }
            ],
            max_tokens: llmConfig.maxTokens,
            temperature: llmConfig.temperature,
            stream: false,
            response_format: {
                type: 'json_object',
            },
        }
    )
    if (!ret?.choices?.length || !ret.choices[0].message.content) {
        return {}
    }
    return JSON.parse(ret.choices[0].message.content)
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

/*删除文献解读历史记录*/
export async function removeLiterature(curUserInfo, resCode) {
    let resInfo = await resInfoDac.getByCode(resCode)
    if (!resInfo || resInfo.operator?.userCode !== curUserInfo.userCode || !resInfo.manageTypes?.includes('literature')) {
        throw new Error('阅读记录不存在')
    }
    if (resInfo.manageTypes.length > 1) {
        return resInfoDac.upsert({
            resCode,
            manageTypes: resInfo.manageTypes.filter(_ => _ !== 'literature'),
        })
    }
    return resInfoDac.update({resCode, status: -1})
}