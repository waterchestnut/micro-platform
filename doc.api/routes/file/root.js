import {getFileObject, saveExtInfos, saveFile} from '../../services/core/fileInfo.js'
import {extractTextByFileCode} from '../../services/core/fileExtract.js'
import {md5} from '../../tools/security.js'
import {convertImage} from '../../grpc/clients/converter.js'

export default async function (fastify, opts) {
    // 按文件提取纯文本（供 AI 判分附件题等；pdf/docx/xlsx/xls/csv/html/txt/md/json/图片）
    fastify.post('/extract/text', {
        schema: {
            description: '按 fileCode 提取附件纯文本',
            summary: '附件文本提取',
            body: {
                type: 'object',
                properties: {
                    fileCode: {type: 'string'}
                },
                required: ['fileCode']
            },
            response: {}
        }
    }, async function (request, reply) {
        const {fileCode} = request.body
        try {
            const ret = await extractTextByFileCode(fileCode)
            return {code: 0, statusCode: 200, data: ret}
        } catch (e) {
            request.log.error(e)
            return {code: -1, statusCode: 200, message: String(e.message || e).slice(0, 200)}
        }
    })

    fastify.post('/upload', async function (request, reply) {

        let ret = []
        let extInfo = {}
        const parts = request.parts()
        for await (const part of parts) {
            if (part.type !== 'file') {
                extInfo[part.fieldname] = part.value
            } else {
                const buffer = await part.toBuffer()
                let fileRet = await saveFile({
                    fileName: part.filename,
                    encoding: part.encoding,
                    mimetype: part.mimetype
                }, extInfo, buffer, request.reqParams?.folder, request.userInfo)
                ret.push(fileRet)
            }
        }
        if (Object.keys(extInfo)) {
            await saveExtInfos(ret.map(_ => _.fileCode), extInfo)
        }
        return ret
    })

    fastify.post('/upload/simple', async function (request, reply) {

        const data = await request.file()
        let extInfo = {}
        for (let key in data.fields) {
            extInfo[data.fields[key].fieldname] = data.fields[key].value
        }
        const buffer = await data.toBuffer()
        return saveFile({
            fileName: data.filename,
            encoding: data.encoding,
            mimetype: data.mimetype
        }, extInfo, buffer, request.reqParams?.folder, request.userInfo)
    })

    fastify.post('/upload/unique', async function (request, reply) {

        const data = await request.file()
        let extInfo = {}
        for (let key in data.fields) {
            extInfo[data.fields[key].fieldname] = data.fields[key].value
        }
        const buffer = await data.toBuffer()
        return saveFile({
            fileName: data.filename,
            encoding: data.encoding,
            mimetype: data.mimetype,
            storeType: 'unique',
            fileCode: request.reqParams?.fileCode
        }, extInfo, buffer, request.reqParams?.folder, request.userInfo)
    })

    fastify.get('/download/:fileName?', async function (request, reply) {
        try {
            let fileRet = await getFileObject(request.reqParams.fileCode)
            let filename = request.reqParams.fileName || fileRet.fileInfo.fileName
            let contentType = request.reqParams.directDownload ? 'application/octet-stream' : (fileRet.fileInfo.mimetype || 'application/octet-stream')
            reply.header('Content-Disposition', `${request.reqParams.directDownload ? 'attachment' : 'inline'}; filename="${encodeURIComponent(filename)}"`)
            reply.type(contentType)
            reply.header('Content-Length', fileRet.fileInfo.fileSize)

            return fileRet.fileStream
        } catch (err) {
            reply.status(404)
            return {code: 404, msg: err.message || ''}
        }
    })

    fastify.post('/upload/user-unique', async function (request, reply) {

        const data = await request.file()
        let extInfo = {}
        for (let key in data.fields) {
            extInfo[data.fields[key].fieldname] = data.fields[key].value
        }
        let buffer = await data.toBuffer()
        let fileName = data.filename
        let mimetype = data.mimetype
        let fileCode = md5(`${request.userInfo.userCode}-${request.reqParams.fileCode}`)
        // 仅windows环境支持emf/wmf图片转化，暂时屏蔽
        /*if (request.reqParams?.formatFile && (mimetype.endsWith('emf') || mimetype.endsWith('wmf'))) {
            fileName = fileName + '.png'
            mimetype = 'image/png'
            buffer = await convertImage(buffer, 'PNG')
        }*/
        return saveFile({
            fileName,
            encoding: data.encoding,
            mimetype,
            storeType: 'unique',
            fileCode
        }, extInfo, buffer, request.reqParams?.folder, request.userInfo)
    })
}
