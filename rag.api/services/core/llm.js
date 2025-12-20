/**
 * @fileOverview 大模型服务调用相关的逻辑
 * @author xianyang 2025/6/24
 * @module
 */
import OpenAI from 'openai'
import {getContentVector} from '../openai/embedding.js'
import ragSegmentDac from '../../daos/core/dac/ragSegmentDac.js'
import {search} from '../../daos/milvus/dac/chunkDac.js'

/*生成PPT测试*/
export async function generatePPT() {
    const openai = new OpenAI({
        apiKey: 'any',
        baseURL: 'http://localhost:9997/v1',
    })
    let subject = '大数据如何改变世界'
    let vector = (await getContentVector(subject))[0]
    let vecRet = await search({
        vector,
        limit: 15,
        output_fields: ['ragChunkCode', 'ragSegmentCode'],
        filters: `ragCode = 'xuexi-cn-journal'`
    })
    /*console.log(JSON.stringify(vecRet))*/
    let ragSegmentCodeList = (vecRet.rows || vecRet)?.map(_ => _.ragSegmentCode)
    let segInfoList = await ragSegmentDac.getTop(ragSegmentCodeList.length, {ragSegmentCode: ragSegmentCodeList})
    let userContent = ['**原文材料：**']
    segInfoList.forEach(item => {
        userContent.push(`材料标识：${item.ragSegmentCode}，材料原文：${item.content}`)
    })
    userContent.push(`主题：${subject}`)
    let ret = await openai.chat.completions.create(
        {
            model: 'qwen3',
            messages: [
                {
                    'role': 'system',
                    'content': '你是一个课程思政语录摘取助手，根据用户的主题从用户提供的材料中摘取3段文本，使用两个美元符分割，每段文本总字数不超过500个字符，每段返回格式：{"ragSegmentCode":"<材料标识>","text":"<本段文本内容>"}，只能从用户给定的材料中摘取原文，不能随意发挥，如果没有合适的原文摘取，请回答：未找到。'
                },
                {
                    'role': 'user',
                    'content': userContent.join('\n'),
                }
            ],
            max_tokens: 8120,
            temperature: 0.7
        }
    )
    console.log(JSON.stringify(ret))
}