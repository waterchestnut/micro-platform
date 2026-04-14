# 日志统计服务 (Statistic API)

基于 Node.js Fastify 的日志统计服务，提供日志收集、查询、统计等功能。

## 功能特性

- **日志收集**: 日志接收与存储
- **日志查询**: 日志检索与筛选
- **统计分析**: 日志数据统计
- **用户行为分析**: 用户操作追踪
- **IP 解析**: IP 地理位置解析

## 技术栈

- Fastify 5.x - Web 框架
- MongoDB (Mongoose) - 数据库
- Redis (ioredis) - 缓存
- Elasticsearch - 日志存储与搜索
- Kafka - 消息队列
- gRPC - 服务间通信
- ipaddr.js - IP 地址处理

## 目录结构

```
statistic.api/
├── app.js                 # 应用入口
├── config/                # 配置文件
├── plugins/               # Fastify 插件
├── routes/                # 路由
│   ├── core/             # 核心功能
│   │   ├── log/          # 日志管理
│   │   ├── statistic/    # 统计分析
│   │   └── user-action/  # 用户行为
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
- `ELASTICSEARCH_*` - Elasticsearch 配置
- `KAFKA_BROKERS` - Kafka 服务器地址

## 依赖

### 主要依赖

- `es8` - Elasticsearch 客户端
- `ipaddr.js` - IP 地址处理
- `kafkajs` - Kafka 客户端

## API 文档

服务启动后访问：
- Swagger UI: `http://localhost:12010/documentation`
- OpenAPI: `http://localhost:12010/documentation/json`

## 许可证

MIT License