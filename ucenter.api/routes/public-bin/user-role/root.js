import * as groupService from '../../../services/core/group.js'
import {getListResSwaggerSchema} from '../../../daos/swaggerSchema/responseHandler.js'
import * as userInfoService from "../../../services/core/userInfo.js";




export default async function (fastify, opts) {
    const checkSchema = {
        description: '获取平台所有的角色列表',
        summary: '获取角色列表',
        tags: ['public-bin'],
        response: {
            default: {
                ...getListResSwaggerSchema({
                    type: 'object',
                    properties: {
                        groupCode: {type: 'string'},
                        groupName: {type: 'string'}
                    },
                    required: ['groupCode', 'groupName'],
                })
            }
        }
    }
    fastify.get('/group/all', {schema: checkSchema}, async function (request, reply) {
        let ret = await groupService.getGroups({}, 1, 1000)
        return ret?.rows || []
    })


}
