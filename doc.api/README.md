# 文件服务 (Doc API)

基于 Node.js Fastify 的文件服务，提供文件上传、存储、管理等功能。

## 功能特性

- **文件上传**: 大文件分片上传
- **文件存储**: MinIO 对象存储集成
- **文件管理**: 文件预览、下载、删除
- **格式转换**: 文件格式转换支持

## 技术栈

- Fastify 5.x - Web 框架
- MongoDB (Mongoose) - 数据库
- Redis (ioredis) - 缓存
- MinIO - 对象存储
- gRPC - 服务间通信

## 目录结构

```
doc.api/
├── app.js                 # 应用入口
├── config/                # 配置文件
├── plugins/               # Fastify 插件
├── routes/                # 路由
│   ├── core/             # 核心功能
│   │   ├── doc/          # 文档管理
│   │   └── file/         # 文件管理
│   └── example/          # 示例接口
├── services/             # 业务逻辑
├── daos/                 # 数据访问层
│   └── core/definition/  # 数据模型定义
├── grpc/                 # gRPC 服务
│   ├── clients/          # gRPC 客户端
│   └── servers/          # gRPC 服务端
└── plugins/              # 扩展插件
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式 (热重载)
pnpm run dev

# 生产模式
pnpm run start

# 运行测试
pnpm run test

# 启动 gRPC 服务
pnpm run grpc
```

## 环境配置

复制 `.env.example` 为 `.env` 并配置以下环境变量：

- `MONGODB_URI` - MongoDB 连接地址
- `REDIS_HOST` / `REDIS_PORT` - Redis 连接
- `MINIO_*` - MinIO 对象存储配置

## API 文档

服务启动后访问：
- Swagger UI: `http://localhost:12004/documentation`
- OpenAPI: `http://localhost:12004/documentation/json`

## 依赖

### 主要依赖

- `@fastify/multipart` - 文件上传
- `minio` - MinIO 客户端

## 许可证

MIT License