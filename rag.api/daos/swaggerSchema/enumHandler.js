/**
 * @fileOverview 枚举的schema转化为swagger的schema
 * @author xianyang
 * @module
 */

import fs from 'fs'

const baseDir = rag.baseDir

export const getAllEnumModels = async (options = {}) => {
    let ret = {}
    let path = baseDir + 'daos/core/enum'
    let files = fs.readdirSync(path)
    for (let file of files) {
        if (~file.indexOf('.js')) {
            let fileName = file.substring(0, file.indexOf('.js'))
            let Model = await import('../core/enum/' + fileName + '.js')
            /*console.log(Model.default)*/
            ret[fileName] = {
                type: 'object',
                title: fileName,
                properties: {}
            }
            Model.default.enumList.forEach(entity => {
                ret[fileName].properties[entity.key] = {
                    type: typeof entity.value,
                    description: entity.description,
                    value: entity.value
                }
            })
        }
    }
    return ret
}