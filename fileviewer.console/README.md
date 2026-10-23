# fileviewer.console

通用文件在线预览控制台。基于 Vue 3 + Vite + TypeScript，用 `@flyfish-group/file-viewer3` 纯前端渲染，支持 docx/pptx/xlsx/pdf/图片等常见办公与文档格式。

与 `pdfviewer.console` 的分工：pdfviewer 是带 AI 解读的文献阅读器；fileviewer 是轻量的通用格式预览器（无后端转换依赖）。

## 技术栈

- Vue 3.5 + TypeScript 5.8 + Vite 6
- Vue Router 4 + Pinia
- @flyfish-group/file-viewer3
- pnpm

## 开发

```bash
pnpm install
copy .env.example .env   # 默认 12001/11002/12004 本机平台服务
pnpm dev                 # http://127.0.0.1:10017
pnpm build               # 产物 dist/，配合 nginx-fileviewer.conf(11017)
```

开发地址：http://127.0.0.1:10017 ；生产站点：11017（`nginx-fileviewer.conf`）

## 文件预览模式

| 模式 | 示例 |
|------|------|
| URL 直链 | `/preview?url=https://example.com/file.docx` |
| fileCode + fileName | `/preview/{fileCode}?fileName=xxx`（走 doc.api `/file/download` 协议） |
| fileCode 自动下载 | `/preview/{fileCode}`（从 Content-Disposition 取文件名） |

## 环境变量（transformIndexHtml 注入到 window）

- `UCENTER_API_BASE` / `UCENTER_PLATFORM_BASE` / `DOC_API_BASE`

## 平台接入

- 独立访问：经 `client-proxy/oauth` 走 ucenter SSO（nginx 已转发）
- wujie 嵌入主 console：把本应用注册为 Client（app.api），`endpoints.pc.visitPath` 指向 `http://<host>:11017`；`src/utils/embed.ts` 检测嵌入态自动预留 64px 顶栏
- 业务系统跳转预览：拼 `FILEVIEWER_PLATFORM_BASE + /preview/{fileCode}?fileName=`（cw2pc 各 console 已内置 `getPreviewUrl()`）

## 目录结构

```
src/
├── main.ts                  # 入口
├── App.vue                  # 根组件（wujie 嵌入适配）
├── router/index.ts          # 路由
├── views/FilePreview/       # 文件预览页
├── utils/embed.ts           # wujie 嵌入工具
├── styles/global.css        # 全局样式
└── env.d.ts                 # 类型声明
```
