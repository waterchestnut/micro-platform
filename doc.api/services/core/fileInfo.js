/**
 * @fileOverview 文件相关的业务操作
 * @author xianyang
 * @module
 */

import fileInfoDac from '../../daos/core/dac/fileInfoDac.js'
import retSchema from '../../daos/retSchema.js'
import {getMinioClient} from '../../daos/minio/minioClient.js'
import dayjs from 'dayjs'
import StoreTypeEnum from '../../daos/core/enum/StoreTypeEnum.js'
import crypto from 'crypto'
import * as buffer from 'node:buffer'

const tools = doc.tools
const logger = doc.logger
const config = doc.config

/**
 * @description 获取文件元数据信息
 * @author xianyang
 * @param {String} fileCode 文件标识
 * @returns {Promise<Object>} 文件元数据详细信息
 */
export async function getFileInfo(fileCode) {
    return fileInfoDac.getByCode(fileCode)
}

/**
 * @description 获取文件元数据以及物理文件信息
 * @author xianyang
 * @param {String} fileCode 文件标识
 * @returns {Promise<Object>} 文件元数据以及物理文件详细信息
 */
export async function getFileObject(fileCode) {
    let fileInfo = await fileInfoDac.getByCode(fileCode)
    if (!fileInfo?.fileCode) {
        throw new Error('文件不存在')
    }
    let minioClient = getMinioClient(fileInfo.minioCode)
    if (!minioClient) {
        throw new Error('文件存储位不存在')
    }
    /*let stat = await minioClient.statObject(minioClient.bucketName, fileInfo.filePath)
    console.log(fileInfo.fileSize, stat.size)*/
    return {
        fileInfo,
        fileStream: await minioClient.getObject(minioClient.bucketName, fileInfo.filePath)
    }
}

/**
 * @description 文件上传minio，并保存元数据
 * @author xianyang
 * @param {Object} fileInfo 文件元数据基本信息
 * @param {Object} extInfo 文件扩展信息
 * @param {Buffer} buffer 文件流
 * @param {String} folder 基础文件夹
 * @param {Object} curUserInfo 当前登录用户
 * @returns {Promise<Object>} 保存后的文件元数据信息
 */
export async function saveFile(fileInfo, extInfo, buffer, folder = 'general', curUserInfo = {}) {
    let fileCode
    let filePath
    let fileSize = fileInfo.fileSize || buffer.length
    const matches = fileInfo.fileName.split('.')
    let fileExt = matches[matches.length - 1].toLowerCase()
    const hash = crypto.createHash('md5')
    hash.update(buffer)
    let operator
    if (curUserInfo?.userCode) {
        operator = {
            userCode: curUserInfo.userCode,
            realName: curUserInfo.realName
        }
    }
    const fileHashCode = hash.digest('hex')
    if (fileInfo.fileCode) {
        fileCode = fileInfo.fileCode
        let existRecord = await fileInfoDac.getByCode(fileCode)
        if (existRecord && existRecord.storeType !== StoreTypeEnum.unique.value) {
            throw Error('文件标识不能重复')
        } else if (existRecord) {
            fileInfo.storeType = existRecord.storeType
        }
        if (existRecord?.filePath) {
            filePath = existRecord.filePath
        }
    } else {
        fileCode = tools.getUUID()
    }
    if (!filePath) {
        let now = dayjs()
        filePath = `${folder}/${now.year()}/${now.format('YYYYMMDD')}/${fileCode}.${fileExt}`
    }

    let minioClient = getMinioClient()
    await minioClient.putObject(minioClient.bucketName, filePath, buffer, fileInfo.fileSize, {'Content-Type': fileInfo.mimetype, ...extInfo})

    await fileInfoDac.upsert({
        fileCode,
        fileName: fileInfo.fileName,
        filePath,
        fileHashCode,
        fileExt,
        fileSize,
        sourceType: fileInfo.sourceType,
        storeType: fileInfo.storeType,
        minioCode: minioClient.minioCode,
        encoding: fileInfo.encoding,
        mimetype: fileInfo.mimetype,
        extInfo,
        operator
    })

    return {
        fileCode,
        fileHashCode,
        fileExt,
        fileSize,
        encoding: fileInfo.encoding,
        mimetype: fileInfo.mimetype,
        fileName: fileInfo.fileName,
    }
}

/**
 * @description 保存文件扩展信息
 * @author xianyang
 * @param {Object} fileCodes 文件标识列表
 * @param {Object} extInfo 文件扩展信息
 * @returns {Promise<Object>} 保存后的mongodb返回值
 */
export async function saveExtInfos(fileCodes, extInfo) {
    return fileInfoDac.update({extInfo}, {fileCode: {$in: fileCodes}})
}

/**
 * @description 复制一份文件
 * @author xianyang
 * @param {String} originalFileCode 源文件标识
 * @param {Object} fileInfo 目标文件元数据基本信息
 * @param {String} folder 基础文件夹
 * @param {Object} curUserInfo 当前登录用户
 * @returns {Promise<Object>} 复制后的文件元数据信息
 */
export async function copyFile(originalFileCode, fileInfo, folder = 'general', curUserInfo = {}) {
    let originalFileInfo = await fileInfoDac.getByCode(originalFileCode)
    if (!originalFileInfo) {
        throw new Error('源文件不存在')
    }
    let fileCode = fileInfo.fileCode || tools.getUUID()
    let now = dayjs()
    const filePath = `${folder}/${now.year()}/${now.format('YYYYMMDD')}/${fileCode}.${originalFileInfo.fileExt}`
    let operator = {
        userCode: curUserInfo.userCode,
        realName: curUserInfo.realName
    }
    let minioClient = getMinioClient(originalFileInfo.minioCode)
    await minioClient.copyObject(minioClient.bucketName, filePath, `/${minioClient.bucketName}/${originalFileInfo.filePath}`)

    let newInfo = {
        ...originalFileInfo,
        filePath,
        sourceType: 'copy',
        minioCode: minioClient.minioCode,
        operator,
        ...fileInfo,
        fileCode,
        insertTime: new Date(),
        updateTime: new Date()
    }
    await fileInfoDac.upsert(newInfo)

    return {
        fileCode,
        fileHashCode: newInfo.fileHashCode,
        fileExt: newInfo.fileExt,
        fileSize: newInfo.fileSize,
        encoding: newInfo.encoding,
        mimetype: newInfo.mimetype,
        fileName: newInfo.fileName,
    }
}