# 用户与授权控制台 (UCenter Console)

基于 Ant Design Pro 的用户与授权管理控制台，提供用户、权限、组织架构管理。

## 功能特性

- **用户管理**: 用户增删改查、批量导入
- **权限管理**: 角色、模块、页面权限
- **组织架构**: 组织、部门、岗位、群组管理
- **客户端管理**: 第三方应用配置
- **协议管理**: 用户协议配置

## 技术栈

- Umi Max - 企业级 React 框架
- Ant Design Pro - 企业级 UI 组件库
- Ant Design - UI 组件库
- React 18 - UI 库

## 目录结构

```
ucenter.console/
├── config/                # 配置文件
│   ├── config.ts          # 主配置
│   ├── routes.ts         # 路由配置
│   ├── proxy.ts          # 代理配置
│   └── defaultSettings.ts # 默认设置
├── mock/                  # Mock 数据
├── src/
│   ├── components/       # 公共组件
│   ├── layouts/          # 布局组件
│   ├── pages/            # 页面组件
│   │   ├── user/        # 用户管理
│   │   ├── auth/        # 权限管理
│   │   └── org/         # 组织架构
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

- `PORT` - 服务端口 (默认 10002)
- `REACT_APP_ENV` - 环境标识 (dev/test/pre)
- `UMI_ENV` - Umi 环境

## 依赖

### 主要依赖

- `@ant-design/pro-components` - Pro 组件
- `@ant-design/icons` - 图标库
- `antd` - Ant Design 核心

## 许可证

MIT License