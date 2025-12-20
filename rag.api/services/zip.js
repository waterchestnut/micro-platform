/**
 * @fileOverview zip压缩包相关的服务
 * @author xianyang 2025/6/4
 * @module
 */

import AdmZip from 'adm-zip'
import fs from 'fs'

const logger = rag.logger

/*计算工具书、年鉴的条目数量*/
export async function countItemsContentCount(typeName = '工具书', itemFileName = 'items.xml') {
    let folder = `\\\\D:\\${typeName}\\未加密`
    let files = fs.readdirSync(folder)
    let totalCount = 0
    for (let file of files) {
        try {
            if (~file.indexOf('.zip')) {
                console.log(file)
                let zip = new AdmZip(folder + '\\' + file, {})
                let text = zip.readAsText(itemFileName, 'utf-8')
                let count = (text.split('<Content>')?.length || 1) - 1
                totalCount += count
                fs.appendFileSync(`${typeName}词条统计.txt`, `${file}:${count}\r\n`, {encoding: 'utf-8'})
            }
        } catch (e) {
            console.error(e)
            fs.appendFileSync(`${typeName}词条统计.txt`, `${file}:0，该书无法打开：${e}\r\n`, {encoding: 'utf-8'})
        }
    }
    fs.appendFileSync(`${typeName}词条统计.txt`, `总数:${totalCount}\r\n`, {encoding: 'utf-8'})
    return 'done'
}