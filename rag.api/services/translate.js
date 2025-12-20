/**
 * @fileOverview 文本翻译相关的处理
 * @author xianyang 2025/6/18
 * @module
 */

const tools = rag.tools
const logger = rag.logger
const config = rag.config

/*检测文本的语言*/
export async function detectLanguage(text) {
    let url = config.libreTranslateConfig.baseIntranetUrl + '/detect'
    let res = await fetch(url, {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({q: text})
    })
    let ret = await res.json()
    //console.log(ret)
    if (!ret?.length) {
        return ''
    }
    return ret[0].language || ''
}

/*文本翻译为简体中文*/
export async function translate2ZH(text, sourceLanguage) {
    let url = config.libreTranslateConfig.baseIntranetUrl + '/translate'
    let res = await fetch(url, {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({q: text, source: sourceLanguage, target: 'zh-Hans', format: 'text'})
    })
    let ret = await res.json()
    //console.log(ret)
    return ret?.translatedText || ''
}