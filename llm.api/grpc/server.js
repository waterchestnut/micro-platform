/**
 * @fileOverview rpc服务端启动入口
 * @author xianyang
 * @module
 */
import '../init.js'
import grpc from '@grpc/grpc-js'
import dotenv from 'dotenv'
import fs from 'fs'
import {installGrpcShutdown} from './shutdown.js'

// Read the .env file
dotenv.config()

/**
 * 1. 创建gRPC服务器实例
 */
let server = new grpc.Server({
    'grpc.max_send_message_length': process.env.max_message_length ? parseInt(process.env.max_message_length) : 256 * 1024 * 1024,
    'grpc.max_receive_message_length': process.env.max_message_length ? parseInt(process.env.max_message_length) : 256 * 1024 * 1024,
})
/**
 * 2. 服务和实现方法添加到gRPC服务器中
 */
let path = llm.baseDir + 'grpc/servers'
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
        llm.logger.error(err)
        process.exit(1)
        return
    }
    llm.logger.info(`服务器启动成功，端口：${port}。`)
    console.log(`服务器启动成功，端口：${port}。`)
    /**
     * 停机处理装在绑定成功之后：deployment 的 PID 1 已是 node（入口被覆盖过），
     * 而**没有 SIGTERM 处理器时 node 的默认行为是立即终止** ⇒ 在途 RPC 会被当场切断。
     * 见 `grpc/shutdown.js` 的模块注释（这条是补做：入口翻转当初跑在了优雅停止前面）。
     */
    installGrpcShutdown({server, logger: llm.logger})
})