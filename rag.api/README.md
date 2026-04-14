# 知识库服务 (RAG API)

基于 Node.js Fastify 的知识库服务，提供文档管理、向量检索、问答等功能。

## 功能特性

- **知识库管理**: 文档集合、段落管理
- **向量检索**: Milvus 向量数据库集成
- **全文检索**: Elasticsearch 集成
- **文档处理**: 文档解析、chunk 分割
- **AI 问答**: 基于检索的问答系统

## 技术栈

- Fastify 5.x - Web 框架
- MongoDB (Mongoose) - 数据库
- Redis (ioredis) - 缓存
- Milvus - 向量数据库
- Elasticsearch - 全文搜索
- Kafka - 消息队列
- gRPC - 服务间通信

## 目录结构

```
rag.api/
├── app.js                 # 应用入口
├── config/                # 配置文件
├── plugins/               # Fastify 插件
├── routes/                # 路由
│   ├── core/             # 核心功能
│   │   ├── knowledge/    # 知识库管理
│   │   ├── document/     # 文档管理
│   │   └── chat/         # 问答接口
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
- `MILVUS_*` - Milvus 向量数据库配置
- `ELASTICSEARCH_*` - Elasticsearch 配置
- `KAFKA_BROKERS` - Kafka 服务器地址

## 依赖

### 主要依赖

- `@zilliz/milvus2-sdk-node` - Milvus 客户端
- `es8` - Elasticsearch 客户端
- `tiktoken` - Token 计算
- `adm-zip` - ZIP 文件处理

## API 文档

服务启动后访问：
- Swagger UI: `http://localhost:12013/documentation`
- OpenAPI: `http://localhost:12013/documentation/json`

## 许可证

MIT License