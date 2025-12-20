/**
 * @fileOverview 请求响应的schema包装
 * @author xianyang 2024/5/9
 * @module
 */


export function getResSwaggerSchema(data) {
    return {
        type: 'object',
        required: ['statusCode', 'code'],
        properties: {
            statusCode: {type: 'number', description: 'http状态码'},
            code: {type: 'number', description: '业务处理结果码'},
            msg: {type: 'string', description: '业务处理提示语'},
            errorLevel: {type: 'string', description: '错误级别'},
            data: data || {
                type: 'object',
                nullable: true,
                description: '业务处理的数据'
            }
        }
    }
}

export function getPageListResSwaggerSchema(data) {
    return getResSwaggerSchema({
        type: 'object',
        nullable: true,
        description: '分页数据',
        properties: {
            total: {type: 'number', description: '总数'},
            rows: {
                type: 'array',
                items: data
            }
        }
    })
}

export function getListResSwaggerSchema(data) {
    return getResSwaggerSchema({
        type: 'array',
        nullable: true,
        description: '列表数据',
        items: data
    })
}