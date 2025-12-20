/**
 * @fileOverview grpc相关的工具方法
 * @author xianyang 2025/2/19
 * @module
 */
// 用户实现gRPC服务和客户端的核心库
import grpc from '@grpc/grpc-js';
// 动态加载.proto文件的库
import protoLoader from '@grpc/proto-loader';

/**
 * @description 加载proto文件
 * @author menglb
 * @param {String} protoPath proto文件路径
 * @returns {GrpcObject} 是否有权限操作
 */
export function loadProto(protoPath) {
    /**
     * protoLoader.loadSync(PROTO_PATH, { ... })方法
     * 从指定的.proto文件加载定义，并根据选项配置进行解析。
     */
    const packageDefinition = protoLoader.loadSync(
        protoPath,
        {
            keepCase: true, // 保持字段名称的大小写
            longs: String, // 将Protocol Buffers中的long类型字段解析为JavaScript字符串
            enums: String, // 将枚举类型转换为字符串
            defaults: true, // 为所有字段设置默认值
            oneofs: true // 支持oneof字段，这是一种在Protocol Buffers中定义的互斥字段
        });
    /**
     * grpc.loadPackageDefinition(packageDefinition)方法
     * 将@grpc/proto-loader生成的描述加载到gRPC库中，
     * 将加载的Protocol Buffers描述转换为gRPC服务端可以使用的JavaScript对象，以创建客户端和服务端。
     */
    return grpc.loadPackageDefinition(packageDefinition);
}