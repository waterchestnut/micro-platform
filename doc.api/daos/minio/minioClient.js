/**
 * @fileOverview minio的客户端初始化等相关操作
 * @author xianyang
 * @module
 */

import {Client} from 'minio'

const minioConfig = doc.config.minioConfig
const clients = {};

export function getMinioClient(minioCode = '') {
    loadClients()
    minioCode = minioCode || minioConfig.defaultMinioCode
    return clients[minioCode]
}

export function loadClients() {
    for (const minioCode in minioConfig.endPoints) {
        let config = minioConfig.endPoints[minioCode]
        if (!clients[minioCode]) {
            clients[minioCode] = new Client({
                endPoint: config.endPoint,
                port: config.port,
                useSSL: config.useSSL,
                accessKey: config.accessKey,
                secretKey: config.secretKey,
            })
            clients[minioCode].bucketName = config.bucketName;
            clients[minioCode].minioCode = minioCode;
        }
    }
    return clients
}