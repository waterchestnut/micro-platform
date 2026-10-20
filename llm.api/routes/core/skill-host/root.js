import {authenticate, extract} from '../../../services/core/skillHost.js'

export const autoPrefix = '/core/skill-host'

/**
 * @fileOverview 沙箱回连宿主的受控能力接口
 * @description 鉴权只认**能力 token**（Bearer），与用户会话无关：
 * 校验不过 401；token 绑定的 sandboxId 与请求头里的不一致也 401。
 * 这些路由即使在网关下按 `/core/*` 兜底放行也是安全的——没有合法 token 就什么都做不了。
 */
export default async function (fastify, opts) {

    fastify.post('/extract', {
        schema: {
            description: '把文档解析成纯文本。供沙箱内自包含 skill 脚本回连调用，需 Bearer 能力 token',
            summary: '宿主文档解析能力',
            body: {
                type: 'object',
                properties: {
                    url: {type: 'string', maxLength: 4000, description: '文件地址，由宿主下载'},
                    contentBase64: {type: 'string', description: '文件内容 base64，与 url 二选一'},
                    fileType: {type: 'string', enum: ['pdf', 'word', 'excel', 'html'], description: '文件类型'},
                    language: {type: 'string', maxLength: 32, description: '解析语言提示'},
                },
                required: ['fileType'],
            },
            tags: ['skill-host'],
        },
    }, async function (request, reply) {
        const auth = authenticate({
            authorization: request.headers.authorization,
            cap: 'extract',
        })
        if (!auth.ok) {
            const err = new Error(`能力凭据无效：${auth.reason}`)
            err.statusCode = 401
            throw err
        }
        const p = request.reqParams
        return await extract({
            url: p.url,
            contentBase64: p.contentBase64,
            fileType: p.fileType,
            language: p.language,
            sandboxId: auth.payload?.sid,
        })
    })

    fastify.get('/capabilities', {
        schema: {
            description: '列出当前部署开放的能力名（供排错，不返回任何密钥）',
            summary: '宿主能力清单',
            tags: ['skill-host'],
        },
    }, async function (request, reply) {
        const auth = authenticate({authorization: request.headers.authorization, cap: 'extract'})
        return {caps: auth.ok ? ['extract'] : [], authenticated: auth.ok, reason: auth.reason || ''}
    })
}
