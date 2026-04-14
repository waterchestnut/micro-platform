# 微平台主控制台 (Console)

基于 Ant Design Pro 的微平台主控制台，提供统一入口和子模块集成。

## 功能特性

- **统一入口**: 微平台主控制台
- **子模块集成**: 集成各业务控制台 (微前端)
- **AI 对话**: Ant Design X AI 对话组件
- **Markdown 渲染**: X-Markdown 富文本渲染
- **多标签页**: 多窗口管理

## 技术栈

- Umi Max - 企业级 React 框架
- Ant Design Pro - 企业级 UI 组件库
- Ant Design X - AI 组件库
- Ant Design X Markdown - Markdown 渲染
- Wujie React - 微前端框架
- React 18 - UI 库

## 目录结构

```
console/
├── config/                # 配置文件
│   ├── config.ts          # 主配置
│   ├── routes.ts         # 路由配置
│   ├── proxy.ts          # 代理配置
│   └── defaultSettings.ts # 默认设置
├── src/
│   ├── components/       # 公共组件
│   ├── layouts/          # 布局组件
│   ├── pages/            # 页面组件
│   ├── services/         # API 服务
│   ├── models/           # 状态管理
│   ├── utils/            # 工具函数
│   └── app.tsx           # 应用入口
├── public/               # 静态资源
└── tests/                # 测试文件
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm run start

# 生产构建
pnpm run build

# 代码检查
pnpm run lint

# 运行测试
pnpm run test
```

## 环境配置

创建 `.env` 文件配置环境变量：

- `PORT` - 服务端口 (默认 10001)
- `REACT_APP_ENV` - 环境标识 (dev/test/pre)
- `UMI_ENV` - Umi 环境

## 子模块集成

通过 Wujie React 集成以下子控制台：

- 用户中心控制台 (10002)
- 应用管理控制台 (10003)
- 知识库控制台 (10013)
- 日志统计控制台 (10010)

## 依赖

### 主要依赖

- `@ant-design/pro-components` - Pro 组件
- `@ant-design/x` - X 组件
- `@ant-design/x-markdown` - Markdown
- `@ant-design/x-sdk` - X SDK
- `@umijs/openapi` - OpenAPI 集成
- `wujie-react` - 微前端

## 许可证

MIT License