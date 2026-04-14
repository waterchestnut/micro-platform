# 应用管理服务 (App API)

基于 Node.js Fastify 的应用管理服务，提供应用配置、版本管理、部署等功能。

## 功能特性

- **应用管理**: 应用创建、配置、删除
- **版本管理**: 应用版本控制与发布
- **配置中心**: 动态配置管理
- **部署管理**: 应用部署与回滚

## 技术栈

- Fastify 5.x - Web 框架
- MongoDB (Mongoose) - 数据库
- Redis (ioredis) - 缓存
- gRPC - 服务间通信

## 目录结构

```
app.api/
├── app.js                 # 应用入口
├── config/                # 配置文件
├── plugins/               # Fastify 插件
├── routes/                # 路由
│   ├── core/             # 核心功能
│   │   └── app/          # 应用管理
│   ├── public-bin/       # 公共接口
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

## API 文档

服务启动后访问：
- Swagger UI: `http://localhost:12003/documentation`
- OpenAPI: `http://localhost:12003/documentation/json`

## 许可证

MIT License