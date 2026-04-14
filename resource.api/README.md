# 资源服务 (Resource API)

基于 Node.js Fastify 的资源服务，提供资源管理、数据处理、Excel 导入导出等功能。

## 功能特性

- **资源管理**: 资源 CRUD 操作
- **数据处理**: 数据清洗、转换
- **Excel 处理**: Excel 文件读取、导出
- **网页爬取**: Cheerio 网页抓取
- **AI 集成**: OpenAI 集成

## 技术栈

- Fastify 5.x - Web 框架
- MongoDB (Mongoose) - 数据库
- Redis (ioredis) - 缓存
- Elasticsearch - 搜索
- ExcelJS - Excel 处理
- Cheerio - 网页解析
- gRPC - 服务间通信

## 目录结构

```
resource.api/
├── app.js                 # 应用入口
├── config/                # 配置文件
├── plugins/               # Fastify 插件
├── routes/                # 路由
│   ├── core/             # 核心功能
│   │   ├── resource/    # 资源管理
│   │   └── data/         # 数据处理
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
- `OPENAI_API_KEY` - OpenAI API Key

## 依赖

### 主要依赖

- `exceljs` - Excel 处理
- `cheerio` - 网页解析
- `openai` - OpenAI SDK
- `xml2js` - XML 解析

## API 文档

服务启动后访问：
- Swagger UI: `http://localhost:12007/documentation`
- OpenAPI: `http://localhost:12007/documentation/json`

## 许可证

MIT License