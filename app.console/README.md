# 应用管理控制台 (App Console)

基于 Ant Design Pro 的应用管理控制台，提供应用配置、版本管理、部署等功能。

## 功能特性

- **应用管理**: 应用创建、编辑、删除
- **版本管理**: 应用版本控制与发布
- **配置管理**: 应用配置动态调整
- **拖拽排序**: 应用排序管理

## 技术栈

- Umi Max - 企业级 React 框架
- Ant Design Pro - 企业级 UI 组件库
- @dnd-kit - 拖拽组件
- React 18 - UI 库
- vanilla-jsoneditor - JSON 编辑器

## 目录结构

```
app.console/
├── config/                # 配置文件
│   ├── config.ts          # 主配置
│   ├── routes.ts         # 路由配置
│   └── defaultSettings.ts # 默认设置
├── mock/                  # Mock 数据
├── src/
│   ├── components/       # 公共组件
│   ├── layouts/          # 布局组件
│   ├── pages/            # 页面组件
│   │   └── app/         # 应用管理页面
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

- `PORT` - 服务端口 (默认 10003)
- `REACT_APP_ENV` - 环境标识 (dev/test/pre)
- `UMI_ENV` - Umi 环境

## 依赖

### 主要依赖

- `@ant-design/pro-components` - Pro 组件
- `@dnd-kit/core` - 拖拽核心
- `@dnd-kit/sortable` - 排序组件
- `vanilla-jsoneditor` - JSON 编辑器

## 许可证

MIT License