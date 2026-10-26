# 大模型服务 (LLM API)

基于 Node.js Fastify 的大模型服务，提供对话、消息、技能等功能。

## 功能特性

- **对话管理**: 会话创建、消息历史、上下文管理
- **大模型集成**: 支持 OpenAI 等主流大模型 API
- **技能系统**: 自定义技能配置与 gRPC 调用
- **流式输出**: Server-Sent Events (SSE) 支持
- **MCP 集成**: Model Context Protocol 支持
- **Kafka 消息队列**: 异步任务处理

## 技术栈

- Fastify 5.x - Web 框架
- MongoDB (Mongoose) - 数据库
- Redis (ioredis) - 缓存
- Kafka - 消息队列
- OpenAI - 大模型客户端
- gRPC - 服务间通信
- tiktoken - Token 计算

## 目录结构

```
llm.api/
├── app.js                 # 应用入口
├── config/                # 配置文件
├── plugins/               # Fastify 插件
├── routes/                # 路由
│   ├── core/             # 核心功能
│   │   ├── chat/         # 对话接口
│   │   ├── conversation/ # 会话管理
│   │   ├── message/      # 消息管理
│   │   ├── trans/        # 翻译
│   │   ├── grpc-skill/   # gRPC 技能
│   │   └── grpc-skill-my/ # 自定义技能
│   └── example/          # 示例接口
├── services/             # 业务逻辑
├── daos/                 # 数据访问层
│   └── core/definition/  # 数据模型定义
├── grpc/                 # gRPC 服务
│   ├── clients/          # gRPC 客户端
│   └── servers/          # gRPC 服务端
└── tools/                # 工具函数
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
- `KAFKA_BROKERS` - Kafka 服务器地址
- `LLM_RELAY_BASE_URL` / `LLM_RELAY_API_KEY` - 大模型中转站地址与 key（见下节）

## 大模型配置：中转站 + 分级

模型不再逐家供应商配 `URI/APIKEY/MODEL`，而是统一走一个 **OpenAI 兼容中转站**（one-api / new-api 之类），
本服务只按「**族 × 档**」取用，定义集中在 `conf/llmModel.js`：

| 族（family） | 说明 | Pro | Flash | Low |
|---|---|---|---|---|
| `common` | 通用文本 | `relay_common_pro` | `relay_common_flash` | `relay_common_low` |
| `qwen` | 千问系 | `relay_qwen_pro` | `relay_qwen_flash` | `relay_qwen_low` |
| `deepseek` | DeepSeek | `relay_deepseek_pro` | `relay_deepseek_flash` | `relay_deepseek_low` |
| `qwen_vl` | 视觉（可带图） | `relay_qwen_vl_pro` | `relay_qwen_vl_flash` | `relay_qwen_vl_low` |

档位决定预算参数（可逐项用环境变量覆盖）：

| 档 | contextWindow | maxTokens | 典型用途 |
|---|---|---|---|
| pro | 131072 | 60000 | 长上下文、代码、复杂推理；默认文本档 = `relay_common_pro`，带图默认 = `relay_qwen_vl_pro` |
| flash | 65536 | 32768 | 日常问答、翻译（`services/core/trans.js`）、记忆抽取（`memory_extract_model`） |
| low | 32768 | 16384 | 批量/后台任务、抽取降级（`memory_extract_fallbackModel`） |

覆盖方式（键名 = `<模型key>_<字段>`，字段：`model`/`baseURL`/`apiKey`/`maxTokens`/`contextWindow`/`temperature`/`stream`/`tokenizer`/`imageTokens`/`enableThinking`）：

```bash
LLM_RELAY_BASE_URL=http://127.0.0.1:3009/v1   # 中转站基地址（含 /v1）
LLM_RELAY_API_KEY=sk-xxxx                     # 中转站 key
relay_qwen_pro_model=qwen3-max                # 某档位指向的真实模型名
relay_deepseek_pro_enableThinking={"thinking":{"type":"enabled"}}   # 思考类模型的私有参数
LLM_DEFAULT_CONFIG_KEY=relay_common_pro       # 全局默认档位
LLM_DEFAULT_VL_CONFIG_KEY=relay_qwen_vl_pro   # 带图默认档位
```

调用侧（`POST /core/chat/*` 的 `options.llmModel`、agent 任务的 `params.llmModel`）取档位的**优先级**：
请求指定的 `llmModel` > 频道在 `conf/llmChannel.js` 里声明的 `model` > 全局默认（带图自动走视觉档）。

- 历史模型名（`qwenPlus`、`qwenVLPlus`、`deepseek31`、`qwen3xin`、`doubao16`、`kimik2`、`hunyuanLarge`）仍可用：
  `resolveModelKey()` 会归一到对应档位，库里存的旧 `llmModel` 值也照常可查；
- 换后端供应商、加新模型只改中转站的渠道与 `relay_*_model`，本服务代码与 `.env` 结构都不动；
- 每个档位都带 `contextWindow`/`tokenizer`/`imageTokens`，所以聊天上下文预算裁剪（`calcContextBudget`）
  与记忆工具的预算判定对全部模型生效。

## API 文档

服务启动后访问：
- Swagger UI: `http://localhost:12008/documentation`
- OpenAPI: `http://localhost:12008/documentation/json`

## 依赖

### 主要依赖

- `@fastify/*` - Fastify 核心插件
- `mongoose` - MongoDB ODM
- `ioredis` - Redis 客户端
- `kafkajs` - Kafka 客户端
- `openai` - OpenAI SDK
- `@grpc/grpc-js` - gRPC 客户端
- `tiktoken` - Token 计数

## 许可证

MIT License