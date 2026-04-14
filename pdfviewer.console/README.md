# 文献解读器 (PDF Viewer Console)

基于 Ant Design Pro 的文献解读器，提供 PDF 阅读、AI 解读、Markdown 渲染等功能。

## 功能特性

- **PDF 阅读**: PDF 文档在线预览
- **AI 解读**: 基于 Ant Design X 的智能解读
- **Markdown 渲染**: X-Markdown 富文本渲染
- **AI 对话**: 与 AI 讨论文献内容

## 技术栈

- Umi Max - 企业级 React 框架
- Ant Design Pro - 企业级 UI 组件库
- Ant Design X - AI 组件库
- Ant Design X Markdown - Markdown 渲染
- embedpdf-snippet-i18n - PDF 嵌入组件
- React 18 - UI 库

## 目录结构

```
pdfviewer.console/
├── config/                # 配置文件
│   ├── config.ts          # 主配置
│   ├── routes.ts         # 路由配置
│   └── defaultSettings.ts # 默认设置
├── mock/                  # Mock 数据
├── src/
│   ├── components/       # 公共组件
│   ├── layouts/          # 布局组件
│   ├── pages/            # 页面组件
│   │   └── viewer/       # 阅读器页面
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

- `PORT` - 服务端口 (默认 10016)
- `REACT_APP_ENV` - 环境标识 (dev/test/pre)
- `UMI_ENV` - Umi 环境

## 依赖

### 主要依赖

- `@ant-design/pro-components` - Pro 组件
- `@ant-design/x` - X 组件
- `@ant-design/x-markdown` - Markdown
- `@ant-design/x-sdk` - X SDK
- `embedpdf-snippet-i18n` - PDF 嵌入

## 许可证

MIT License