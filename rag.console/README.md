# 知识库控制台 (RAG Console)

基于 Ant Design Pro 的知识库管理控制台，提供知识库创建、文档管理、智能问答等功能。

## 功能特性

- **知识库管理**: 创建、编辑、删除知识库
- **文档管理**: 文档上传、预览、chunk 管理
- **智能问答**: 基于知识库的问答系统
- **向量管理**: 向量检索配置

## 技术栈

- Umi Max - 企业级 React 框架
- Ant Design Pro - 企业级 UI 组件库
- React 18 - UI 库

## 目录结构

```
rag.console/
├── config/                # 配置文件
│   ├── config.ts          # 主配置
│   ├── routes.ts         # 路由配置
│   └── defaultSettings.ts # 默认设置
├── mock/                  # Mock 数据
├── src/
│   ├── components/       # 公共组件
│   ├── layouts/          # 布局组件
│   ├── pages/            # 页面组件
│   │   ├── knowledge/   # 知识库管理
│   │   ├── document/    # 文档管理
│   │   └── chat/        # 问答页面
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

- `PORT` - 服务端口 (默认 10013)
- `REACT_APP_ENV` - 环境标识 (dev/test/pre)
- `UMI_ENV` - Umi 环境

## 依赖

### 主要依赖

- `@ant-design/pro-components` - Pro 组件
- `@ant-design/icons` - 图标库
- `mime` - MIME 类型

## 许可证

MIT License