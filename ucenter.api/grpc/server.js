/**
 * @fileOverview rpc服务端启动入口
 * @author xianyang
 * @module
 */
import '../init.js'
import grpc from '@grpc/grpc-js'
import fs from "fs"

/**
 * 1. 创建gRPC服务器实例
 */
let server = new grpc.Server()
/**
 * 2. 服务和实现方法添加到gRPC服务器中
 */
let path = ucenter.baseDir + 'grpc/servers'
let files = fs.readdirSync(path)
for (let file of files) {
    if (~file.indexOf('.js')) {
        let fileName = file.substring(0, file.indexOf('.js'))
        let {initService} = await import('./servers/' + fileName + '.js')
        initService && initService(server)
    }
}
/**
 * 3. 绑定服务器到指定的地址和端口，并使用不安全的凭据（没有 SSL/TLS）
 * grpc.ServerCredentials.createInsecure(): 创建不安全的服务器凭据
 */
server.bindAsync(`${process.env.GRPC_ADDRESS || '0.0.0.0'}:${process.env.GRPC_PORT || 50051}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err != null) {
        ucenter.logger.error(err)
        process.exit(1)
        return
    }
    ucenter.logger.info(`服务器启动成功，端口：${port}。`)
    console.log(`服务器启动成功，端口：${port}。`)
});