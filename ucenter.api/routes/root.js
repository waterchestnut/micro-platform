import * as userInfoService from '../services/core/userInfo.js';
import { getResSwaggerSchema } from '../daos/swaggerSchema/responseHandler.js';

export default async function (fastify, opts) {
  // 用户详情的 Schema
  const userSchema = { $ref: 'fullParamModels#/properties/UserInfo' };

  // 根路径测试
  const schema = {
    description: 'some data',
    summary: '根路径测试',
    querystring: {
      type: 'object',
      properties: {
        userCode: { type: 'string' },
      },
      required: ['userCode'],
    },
    response: {
      default: {
        ...getResSwaggerSchema(userSchema),
      },
    },
  };

  // 路由: 获取用户详细信息
  fastify.get('/', { schema }, async function (request, reply) {
    return { data: await userInfoService.getUserDetail('123') };
  });

}
