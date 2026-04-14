# 大模型服务 (LLM API)

基于 Node.js Fastify 的大模型服务，提供对话、消息、技能等功能。

## 功能特性

- **对话管理**: 会话创建、消息历史、上下文管理
- **大模型集成**: 支持 OpenAI 等主流大模型 API
- **技能系统**: 自定义技能配置与 gRPC 调用
- **流式输出**: Server-Sent Events (SSE) 支持
- **MCP 集成**: Model Context Protocol 支持
- **Kafka 消息队列**: 异步任务处理

## 技术栈

- Fastify 5.x - Web 框架
- MongoDB (Mongoose) - 数据库
- Redis (ioredis) - 缓存
- Kafka - 消息队列
- OpenAI - 大模型客户端
- gRPC - 服务间通信
- tiktoken - Token 计算

## 目录结构

```
llm.api/
├── app.js                 # 应用入口
├── config/                # 配置文件
├── plugins/               # Fastify 插件
├── routes/                # 路由
│   ├── core/             # 核心功能
│   │   ├── chat/         # 对话接口
│   │   ├── conversation/ # 会话管理
│   │   ├── message/      # 消息管理
│   │   ├── trans/        # 翻译
│   │   ├── grpc-skill/   # gRPC 技能
│   │   └── grpc-skill-my/ # 自定义技能
│   └── example/          # 示例接口
├── services/             # 业务逻辑
├── daos/                 # 数据访问层
│   └── core/definition/  # 数据模型定义
├── grpc/                 # gRPC 服务
│   ├── clients/          # gRPC 客户端
│   └── servers/          # gRPC 服务端
└── tools/                # 工具函数
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
- `KAFKA_BROKERS` - Kafka 服务器地址
- `OPENAI_API_KEY` - OpenAI API Key

## API 文档

服务启动后访问：
- Swagger UI: `http://localhost:12008/documentation`
- OpenAPI: `http://localhost:12008/documentation/json`

## 依赖

### 主要依赖

- `@fastify/*` - Fastify 核心插件
- `mongoose` - MongoDB ODM
- `ioredis` - Redis 客户端
- `kafkajs` - Kafka 客户端
- `openai` - OpenAI SDK
- `@grpc/grpc-js` - gRPC 客户端
- `tiktoken` - Token 计数

## 许可证

MIT License