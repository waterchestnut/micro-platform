/**
 * @fileOverview grpc远程技能命令执行基础服务
 * @author xianyang
 * @module
 */
import fs from 'fs'

const tools = resource.tools
const logger = resource.logger
const config = resource.config

/*获取技能命令执行器对象*/
async function getSkillHandler(skillName) {
    let handlerFilePath = resource.baseDir + 'services/skill/handler/' + skillName + '.js'
    if (!fs.existsSync(handlerFilePath)) {
        logger.error('getSkillHandler，技能命令执行器不存在：' + skillName)
        throw new Error('技能命令执行器不存在')
    }
    let Handler = (await import('./handler/' + skillName + '.js')).default
    /*console.log(Handler)*/
    return new Handler()
}

/*执行技能命令*/
export async function execCommand(skillName, commandName, params, curUserInfo) {
    let ret
    try {
        let handler = await getSkillHandler(skillName)
        ret = await handler.execCommand(commandName, params, curUserInfo)
    } catch (e) {
        ret = {
            code: -1,
            msg: e.message || e,
        }
    }
    return ret
}