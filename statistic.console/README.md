# 日志统计控制台 (Statistic Console)

基于 Ant Design Pro 的日志统计控制台，提供日志查看、统计图表、用户行为分析等功能。

## 功能特性

- **日志查看**: 日志列表、详情查看
- **统计分析**: 数据统计与图表展示
- **用户行为**: 用户操作追踪与分析
- **JSON 查看**: 结构化日志查看器

## 技术栈

- Umi Max - 企业级 React 框架
- Ant Design Pro - 企业级 UI 组件库
- React 18 - UI 库
- @microlink/react-json-view - JSON 查看器

## 目录结构

```
statistic.console/
├── config/                # 配置文件
│   ├── config.ts          # 主配置
│   ├── routes.ts         # 路由配置
│   └── defaultSettings.ts # 默认设置
├── mock/                  # Mock 数据
├── src/
│   ├── components/       # 公共组件
│   ├── layouts/          # 布局组件
│   ├── pages/            # 页面组件
│   │   ├── log/         # 日志查看
│   │   ├── statistic/   # 统计分析
│   │   └── user-action/ # 用户行为
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

- `PORT` - 服务端口 (默认 10010)
- `REACT_APP_ENV` - 环境标识 (dev/test/pre)
- `UMI_ENV` - Umi 环境

## 依赖

### 主要依赖

- `@ant-design/pro-components` - Pro 组件
- `@microlink/react-json-view` - JSON 查看器

## 许可证

MIT License