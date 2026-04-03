# Agent Skills 系统

参考 Claude Agent Skills 设计实现的领域能力扩展系统，支持频道级配置和自动指令执行。

## 目录结构

```
src/skill/
├── skillManager.js              # Skills 管理器核心
├── skillChat.js                 # 大模型聊天集成模块
├── skillParser.js               # SKILL.md 解析器
├── index.js                     # 统一入口
├── README.md                    # 本文档
├── providers/                   # Skill 提供商
│   ├── grpcSkillProvider.js    # gRPC 远程 Skills 提供商
│   └── localSkillProvider.js   # 本地 Skills 提供商
└── skills/                      # 本地 Skills 目录
    ├── code-reviewer/           # 代码审查专家
    │   ├── SKILL.md
    │   └── scripts/
    │       └── index.js
    ├── api-tester/              # API 测试专家
    │   └── SKILL.md
    ├── refactoring-expert/      # 代码重构专家
    │   └── SKILL.md
    └── document-extractor/      # 文档提取专家
        ├── SKILL.md
        └── scripts/
            └── index.js
```

## 核心模块

### SkillManager

Skills 管理器核心，提供以下功能：

- `initialize()` - 初始化频道 Skills
- `getSkillCandidates()` - 获取候选 Skills 列表
- `matchSkills(query, options)` - 根据查询匹配 Skills
- `generateSystemPrompt(query, options)` - 生成系统提示词（支持分级加载）
- `generateSkillTools(skills)` - 生成 Function Calling 工具定义
- `executeSkillCommand(skillName, commandName, parameters)` - 执行 Skill 指令

### SkillChat

大模型聊天集成模块：

- `initSkillChatContext(query, options)` - 初始化聊天上下文
- `checkSkillSelection(content, skillContext)` - 检查大模型是否选择技能
- `executeSkillToolCalls(toolCalls, skillContext)` - 执行工具调用（自动区分 MCP 和 Skill 工具）
- `getSkillStats(skillContext)` - 获取统计信息

### SkillParser

SKILL.md 解析器：

- `parseSkillContent(content, skillInfo)` - 解析 Skill 内容
- `parseSkillCommands(sections)` - 解析可执行指令
- `parseYaml(yamlContent)` - 解析 YAML Frontmatter

### Providers

- **GrpcSkillProvider**: 从 gRPC 服务加载远程 Skills
- **LocalSkillProvider**: 从本地 `skills/` 目录加载 Skills

## SKILL.md 格式

每个 Skill 目录必须包含 `SKILL.md` 文件，采用 YAML Frontmatter + Markdown 格式：

```markdown
---
name: skill-name                # Skill 名称
description: Skill 描述         # 简短描述
author: 作者                    # 可选
version: 1.0.0                  # 可选
tags:                          # 可选标签
  - tag1
  - tag2
---

# Skill 标题

## When to Use This Skill

描述何时使用此 Skill。

## Instructions

执行指令...

## Examples

使用示例...
```

### 指令定义

在 Instructions 中使用 `@指令名[参数]` 格式定义可执行指令：

```markdown
- @analyzeComplexity[code:string, language:string] - 分析代码复杂度
- @extractFromPdf[url:string, mode:string] - 从 PDF 提取文本
```

## 频道配置

在 `src/conf/llmChannel.js` 中配置频道级 Skills：

```javascript
export default {
    my_channel: {
        skills: {
            enabled: true,
            skillNames: ['code-reviewer', 'document-extractor'],
            maxSkills: 3,
            threshold: 0.3,
            enableSkillExecution: true,
            loadMode: 'candidates'
        }
    }
}
```

### 配置项

| 配置项 | 说明                 | 默认值 |
|--------|--------------------|--------|
| `enabled` | 是否启用 Skills        | true |
| `skillNames` | 指定可用的本地 Skills 列表 | [] |
| `maxSkills` | 最大匹配数量             | 3 |
| `threshold` | 匹配阈值 (0-1)         | 0.3 |
| `enableSkillExecution` | 是否启用指令自动执行         | true |
| `loadMode` | 加载模式               | 'candidates' |

### 加载模式

- `candidates`: 只加载候选列表（名称+描述），大模型选择后再加载详情
- `matched`: 根据匹配分数自动加载匹配技能的详情
- `full`: 加载所有可用技能的完整详情

## 使用方法

### 初始化聊天上下文

```javascript
import { SkillManager } from './skill/skillManager.js'

const skillManager = new SkillManager(channel, curUserInfo)
await skillManager.initialize()

const result = await skillManager.generateSystemPrompt(query, {
    loadMode: 'candidates'
})

// result = { prompt, skills, tools, candidates }
```

### SkillChat 集成

```javascript
import { SkillChat } from './skill/skillChat.js'

const skillChat = new SkillChat(channel, curUserInfo)

// 1. 初始化上下文
const { prompt, context } = await skillChat.initSkillChatContext(query, {
    loadMode: 'candidates'
})

// 2. 检查大模型是否选择技能
const selected = await skillChat.checkSkillSelection(llmResponse, context)
if (selected) {
    // selected = { name, prompt, tools }
}

// 3. 执行工具调用
const results = await skillChat.executeSkillToolCalls(toolCalls, context)

// 4. 获取统计
const stats = skillChat.getSkillStats(context)
```

### 执行 Skill 指令

```javascript
const result = await skillManager.executeSkillCommand(
    'code-reviewer',
    'analyzeComplexity',
    { code: 'function test() {}', language: 'javascript' }
)
```

## 本地 Skill 开发

### 1. 创建 Skill 目录

```
src/skill/skills/my-skill/
├── SKILL.md
└── scripts/
    └── index.js
```

### 2. 编写 SKILL.md

```markdown
---
name: my-skill
description: 我的自定义 Skill
tags:
  - custom
---

# 我的 Skill

## When to Use This Skill

描述何时使用...

## Instructions

执行指令... @doSomething[input:string]

## Examples

示例...
```

### 3. 编写执行脚本

```javascript
// scripts/index.js
export async function executeCommand(commandName, parameters = {}) {
    switch (commandName) {
        case 'doSomething':
            return await doSomething(parameters)
        default:
            throw new Error(`未知命令: ${commandName}`)
    }
}

async function doSomething({ input }) {
    return { success: true, result: `处理: ${input}` }
}
```

## 内置 Skills

### code-reviewer

代码审查专家，帮助发现代码问题、提供优化建议。

**可用指令**：
- `@analyzeComplexity[code:string, language:string]` - 分析代码复杂度
- `@checkSecurity[code:string, language:string]` - 安全检查
- `@suggestRefactoring[code:string, issueType:string]` - 重构建议

### document-extractor

文档内容提取专家，支持 PDF、Word、Excel、HTML。

**可用指令**：
- `@extractFromPdf[url:string, mode:string]` - PDF 提取
- `@extractFromWord[url:string]` - Word 提取
- `@extractFromExcel[url:string, format:string]` - Excel 提取
- `@extractFromHtml[url:string]` - HTML 提取

### api-tester

API 测试专家，帮助设计测试用例。

### refactoring-expert

代码重构专家，识别代码坏味道并提供改进建议。

## API 参考

### SkillManager

```javascript
const manager = new SkillManager(channel, userInfo)

// 初始化
await manager.initialize()

// 获取候选列表
const candidates = await manager.getSkillCandidates()

// 匹配 Skills
const matched = await manager.matchSkills('review my code', { maxSkills: 3 })

// 生成系统提示词
const { prompt, skills, tools, candidates } = await manager.generateSystemPrompt(query, {
    loadMode: 'candidates'
})

// 生成单个 Skill 详情
const detail = await manager.generateSkillDetailPrompt('code-reviewer', {
    enableExecution: true
})

// 执行指令
const result = await manager.executeSkillCommand('code-reviewer', 'analyzeComplexity', {
    code: '...',
    language: 'javascript'
})
```

### SkillLoadMode 枚举

```javascript
import { SkillLoadMode } from './skill/index.js'

SkillLoadMode.CANDIDATES  // 'candidates'
SkillLoadMode.MATCHED     // 'matched'
SkillLoadMode.FULL        // 'full'
```