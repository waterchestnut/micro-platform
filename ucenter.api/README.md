# 用户与授权服务 (UCenter API)

基于 Node.js Fastify 的用户与授权服务，提供用户管理、权限认证、组织架构等功能。

## 功能特性

- **用户管理**: 用户注册、登录、信息修改
- **权限认证**: JWT 令牌、OAuth、验证码
- **组织架构**: 组织、部门、岗位、群组管理
- **客户端管理**: 第三方应用接入
- **短信验证码**: 阿里云短信服务集成
- **邮件服务**: 邮件发送支持

## 技术栈

- Fastify 5.x - Web 框架
- MongoDB (Mongoose) - 数据库
- Redis (ioredis) - 缓存
- JWT - 身份认证
- gRPC - 服务间通信

## 目录结构

```
ucenter.api/
├── app.js                 # 应用入口
├── config/                # 配置文件
├── plugins/               # Fastify 插件
├── routes/                # 路由
│   ├── auth/             # 认证接口
│   │   ├── module/       # 模块权限
│   │   ├── page/         # 页面权限
│   │   └── priv/         # 权限管理
│   ├── oauth/            # OAuth 接口
│   ├── cgi-bin/          # CGI 接口
│   ├── client-proxy/     # 客户端代理
│   ├── public-bin/       # 公共接口
│   ├── core/             # 核心功能
│   │   ├── user/         # 用户管理
│   │   ├── org/          # 组织管理
│   │   ├── department/   # 部门管理
│   │   ├── job/          # 岗位管理
│   │   ├── group/        # 群组管理
│   │   ├── region/       # 区域管理
│   │   ├── client/       # 客户端管理
│   │   └── agreement/    # 协议管理
│   └── example/          # 示例接口
├── services/             # 业务逻辑
│   ├── oauth/            # OAuth 服务
│   ├── search/           # 搜索服务
│   └── client-proxy/     # 客户端代理服务
├── daos/                 # 数据访问层
│   └── core/definition/  # 数据模型定义
└── grpc/                 # gRPC 服务
    ├── clients/          # gRPC 客户端
    └── servers/          # gRPC 服务端
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
- `ALIYUN_SMS_*` - 阿里云短信配置
- `SMTP_*` - 邮件服务配置
- `JWT_SECRET` - JWT 密钥

## API 文档

服务启动后访问：
- Swagger UI: `http://localhost:12001/documentation`
- OpenAPI: `http://localhost:12001/documentation/json`

## 依赖

### 主要依赖

- `@fastify/*` - Fastify 核心插件
- `mongoose` - MongoDB ODM
- `ioredis` - Redis 客户端
- `jsonwebtoken` - JWT 令牌
- `@alicloud/sms-sdk` - 阿里云短信
- `nodemailer` - 邮件发送
- `svg-captcha` - 验证码

## 许可证

MIT License