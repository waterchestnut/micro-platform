# 微平台 (micro-platform)

基于腾讯无界、Ant Design Pro、Node.js Fastify 和 Python FastAPI 的微服务架构平台。

## 项目结构

```
micro-platform/
├── console/                    # 微平台主控制台 (Ant Design Pro)
├── ucenter.console/            # 用户与授权控制台
├── app.console/                # 应用管理控制台
├── rag.console/                # 知识库控制台
├── statistic.console/          # 日志统计控制台
├── pdfviewer.console/          # 文献解读器
│
├── llm.api/                    # 大模型服务 (Node.js Fastify)
├── ucenter.api/                # 用户与授权服务 (Node.js Fastify)
├── app.api/                    # 应用管理服务 (Node.js Fastify)
├── doc.api/                    # 文件服务 (Node.js Fastify)
├── resource.api/               # 资源服务 (Node.js Fastify)
├── rag.api/                    # 知识库服务 (Node.js Fastify)
├── statistic.api/              # 日志统计服务 (Node.js Fastify)
│
└── transform.api/              # 资源转换服务 (Python FastAPI)
```

## 技术栈

### 后端服务
- **Fastify**: 高性能 Node.js Web 框架
- **FastAPI**: 现代 Python Web 框架
- **MongoDB**: 数据库 (通过 Mongoose)
- **Redis**: 缓存与消息队列
- **Elasticsearch**: 日志与搜索
- **gRPC**: 服务间通信
- **Kafka**: 消息队列

### 前端控制台
- **Umi Max**: 企业级 React 应用框架
- **Ant Design Pro**: 企业级 UI 组件库
- **Ant Design X**: AI 组件库
- **React 18**: UI 库

## 快速开始

### 安装依赖

```bash
# 安装所有项目依赖
pnpm install
```

### 启动服务

#### 启动后端 API 服务

```bash
# 启动大模型服务
cd llm.api && pnpm run start

# 启动用户中心服务
cd ucenter.api && pnpm run start

# 启动应用管理服务
cd app.api && pnpm run start

# 启动其他服务...
```

#### 启动前端控制台

```bash
# 启动主控制台
cd console && pnpm run start

# 启动用户中心控制台
cd ucenter.console && pnpm run start

# 启动应用管理控制台
cd app.console && pnpm run start
```

### 环境配置

各服务目录下均有 `.env.example` 文件，复制并重命名为 `.env` 后配置相应的环境变量。

## API 文档

各服务启动后，可通过以下地址访问 API 文档：

- Swagger UI: `/documentation`
- OpenAPI: `/documentation/json`

## 开发命令

### Node.js 服务

```bash
# 开发模式 (热重载)
pnpm run dev

# 生产模式
pnpm run start

# 运行测试
pnpm run test

# 启动 gRPC 服务
pnpm run grpc
```

### 前端控制台

```bash
# 开发模式
pnpm run start

# 生产构建
pnpm run build

# 代码检查
pnpm run lint
```

## 许可证

MIT License