# Agent Skills 系统

参考 Claude Agent Skills 设计实现的领域能力扩展系统，支持频道级配置和自动指令执行。

## 目录结构

```
src/skill/
├── skillManager.js          # Skills 管理器核心
├── skillChat.js             # 大模型聊天集成模块
├── index.js                 # 统一入口
├── README.md                # 本文档
└── skills/                  # Skills 目录（包含所有 Skills）
    ├── code-reviewer/       # 代码审查专家（系统自带）
    │   ├── SKILL.md         # Skill 定义
    │   └── scripts/         # 可执行脚本
    │       └── index.js
    ├── api-tester/          # API 测试专家（系统自带）
    │   └── SKILL.md
    ├── refactoring-expert/  # 代码重构专家（系统自带）
    │   └── SKILL.md
    ├── document-extractor/  # 文档内容提取专家（系统自带）
    │   ├── SKILL.md         # Skill 定义
    │   └── scripts/         # 可执行脚本
    │       └── index.js
    └── [your-skill]/        # 你的自定义 Skill
        ├── SKILL.md         # Skill 定义文件
        ├── scripts/         # 可选：执行脚本
        │   └── index.js     # 脚本入口
        ├── references/      # 可选：参考文档
        └── assets/          # 可选：资源文件
```

**目录说明：**
- `skills/` - 所有 Skills 存放目录，包含系统自带和用户自定义的 Skills

## SKILL.md 格式

每个 Skill 必须包含一个 `SKILL.md` 文件，采用 YAML Frontmatter + Markdown 格式：

```markdown
---
name: skill-name                    # 必需：Skill 名称
description: Skill description      # 必需：简短描述
author: author-name                 # 可选：作者
version: 1.0.0                      # 可选：版本号
tags:                               # 可选：标签数组
  - tag1
  - tag2
---

# Skill 标题

## When to Use This Skill

描述何时应该使用此 Skill。

## Instructions

详细的执行指令，告诉 LLM 如何执行此 Skill。

你可以定义可执行指令：
- @commandName[param1:type1, param2:type2] - 指令描述
- @analyzeCode[code:string, language:string] - 分析代码

## Examples

使用示例。
```

## 频道配置

在 `src/conf/llmChannel.js` 中配置频道级 Skills：

```javascript
export default {
    my_channel: {
        sysPrompt: '...',
        /** Agent Skills 配置 */
        skills: {
            /** 是否启用 Skills */
            enabled: true,
            /** 该频道专用的 Skills 列表（空数组表示使用所有可用 Skills） */
            skillNames: ['code-reviewer', 'api-tester'],
            /** 最大匹配 Skills 数量 */
            maxSkills: 3,
            /** 匹配阈值 */
            threshold: 0.3,
            /** 是否启用 Skill 指令自动执行 */
            enableSkillExecution: true,
        }
    }
}
```

### 配置项说明

- `enabled`: 是否在该频道启用 Skills 系统
- `skillNames`: 限定该频道可用的 Skills（为空数组则允许所有 Skills）
- `maxSkills`: 每次对话最多匹配多少个 Skills
- `threshold`: 匹配分数阈值（0-1），低于此值不触发
- `enableSkillExecution`: 是否允许大模型自动执行 Skill 指令
- `loadMode`: 加载模式
  - `'candidates'` (默认): 只加载候选列表（名称+描述），大模型选择后再加载详情
  - `'matched'`: 根据匹配分数自动加载匹配技能的详情
  - `'full'`: 加载所有可用技能的完整详情

## 分级加载机制

Skills 系统采用三级加载策略，优化 Token 使用：

### 第一步：候选列表（Candidates）
系统首先加载频道中所有可用的 Skills 的名称和描述（不包含详细 instructions）。这告诉大模型有哪些技能可用，但不占用太多 Token。

**提示词示例**：
```
# 可用领域专家技能（Agent Skills）

你拥有以下专业技能可供选择：

## 1. code-reviewer
**描述**: 专业的代码审查专家，帮助发现代码问题、提供优化建议
**标签**: code-review, quality, best-practices

## 2. api-tester
**描述**: API 测试专家，帮助设计测试用例、执行 API 测试和分析结果
**标签**: api-testing, http, testing

**使用说明**：
1. 首先分析用户需求，判断需要使用哪个技能
2. 如果需要使用某个技能，请回复："我将使用技能：[技能名称]"
3. 系统会自动加载该技能的详细说明和可用指令
```

### 第二步：动态加载详情
当大模型回复包含技能选择标记（如"我将使用技能：code-reviewer"）时，系统自动加载该技能的详细说明和可用指令。

**动态加载的提示词示例**：
```
# 技能详细说明：code-reviewer

**描述**: 专业的代码审查专家...

**何时使用**: ...

**执行指令**: 
1. **理解上下文**...
2. **功能性检查**...
...

**可用指令**:
- @analyzeComplexity(code, language): 分析代码复杂度
- @checkSecurity(code, language): 安全检查
- @suggestRefactoring(code, issueType): 提供重构建议
```

### 第三步：执行指令
如果需要，大模型可以调用 Skill 中定义的指令（通过 Function Calling 或 @指令名{} 格式）。

## 使用方法

### 基本用法（已集成在 llmChat 中）

```javascript
// 在 llmChat 中自动使用频道配置
execChat(userInfo, "请帮我 review 这段代码", conversationCode, {
    channel: 'code_assistant',  // 使用 code_assistant 频道的 Skills 配置
    // skillLoadMode: 'candidates',  // 可选：'candidates'(默认) | 'matched' | 'full'
})
```

### 程序化使用

```javascript
import {
    skillManager,
    matchSkillsForChannel,
    generateSystemPromptForChannel,
    executeSkillCommand
} from './skill/index.js'

// 1. 根据频道匹配 Skills
const skills = await matchSkillsForChannel('code_assistant', '请帮我审查这段代码', {
    maxSkills: 3,
    threshold: 0.3
})

// 2. 生成系统提示词（包含 Skills 指令）
const result = await generateSystemPromptForChannel('code_assistant', '请帮我审查这段代码', {
    maxSkills: 2
})
console.log(result.prompt)  // 生成的系统提示词
console.log(result.skills)  // 匹配的 Skills
console.log(result.tools)   // Skill 执行工具定义

// 3. 执行 Skill 指令
const result = await executeSkillCommand(
    'code-reviewer',
    'analyzeComplexity',
    { code: 'function test() { ... }', language: 'javascript' }
)
```

## 添加自定义 Skill

### 1. 创建 Skill 目录和定义文件

```bash
mkdir -p src/skill/skills/my-skill/scripts
```

### 2. 编写 SKILL.md

```markdown
---
name: my-skill
description: 我的自定义 Skill
version: 1.0.0
tags:
  - custom
  - utility
---

# 我的 Skill

## When to Use This Skill

描述何时使用...

## Instructions

执行指令...

可用指令：
- @doSomething[input:string, option:boolean] - 执行某项操作

## Examples

示例说明...
```

### 3. 编写执行脚本（可选）

创建 `scripts/index.js`：

```javascript
/**
 * @description 执行 Skill 命令的入口函数
 * @param {string} commandName - 命令名称
 * @param {Object} parameters - 命令参数
 * @returns {Promise<Object>}
 */
export async function executeCommand(commandName, parameters = {}) {
    switch (commandName) {
        case 'doSomething':
            return await doSomething(parameters)
        default:
            throw new Error(`未知命令: ${commandName}`)
    }
}

async function doSomething(params) {
    const { input, option } = params
    // 实现逻辑
    return {
        success: true,
        result: `处理了: ${input}`,
        option: option
    }
}
```

### 4. 重启服务自动加载

服务启动时会自动扫描 `src/skill/` 目录加载所有 Skills。

## Skill 指令执行机制

### 1. 指令定义

在 SKILL.md 的 Instructions 章节中使用 `@指令名[参数]` 格式定义指令：

```markdown
- @analyzeComplexity[code:string, language:string] - 分析代码复杂度
- @checkSecurity[code:string] - 安全检查
```

### 2. 指令执行

系统会自动：
1. 解析 SKILL.md 中的指令定义
2. 生成 Function Calling 工具定义
3. 大模型根据需要调用指令
4. 系统执行对应的脚本并返回结果
5. 大模型整合结果生成回复

### 3. 脚本实现

在 `scripts/index.js` 中实现指令逻辑：

```javascript
// 方式1：使用 executeCommand 统一入口
export async function executeCommand(commandName, parameters) {
    // 根据 commandName 分发到不同函数
}

// 方式2：使用具名导出
export async function analyzeComplexity(params) { ... }
export async function checkSecurity(params) { ... }
```

## 示例 Skills 说明

### code-reviewer
代码审查专家，帮助发现代码问题、提供优化建议。

**可用指令**：
- `@analyzeComplexity[code, language]` - 分析代码复杂度
- `@checkSecurity[code, language]` - 安全检查
- `@suggestRefactoring[code, issueType]` - 提供重构建议

### api-tester
API 测试专家，帮助设计测试用例、执行 API 测试。

**适用场景**：接口测试、API 文档生成

### refactoring-expert
代码重构专家，帮助改进代码结构、应用设计模式。

**适用场景**：代码重构、坏味道识别

### document-extractor
文档内容提取专家，支持从 PDF、Word、Excel、HTML 等格式文档中提取文本内容。调用 gRPC 服务实现文本提取。

**可用指令**：
- `@extractFromPdf[url, mode]` - 从 PDF 提取文本
  - `url`: 文件 URL（必需）
  - `mode`: 可选，传入 'ocr' 启用 OCR 识别
- `@extractFromWord[url]` - 从 Word 提取文本
  - `url`: 文件 URL（必需）
- `@extractFromExcel[url, format]` - 从 Excel 提取文本
  - `url`: 文件 URL（必需）
  - `format`: 可选，格式类型: 'xls', 'csv', 'xlsx'
- `@extractFromHtml[url]` - 从 HTML 提取文本
  - `url`: 文件 URL（必需）
- `@smartExtract[url, format, mode, subtype]` - 智能提取（自动识别格式）

**适用场景**：文档内容提取、文档分析、格式转换

## API 文档

### SkillManager 类

#### 核心方法

- `initialize()` - 初始化 Skills 系统
- `loadSkill(skillName, options)` - 加载单个 Skill
  - `options.detail` - 是否加载完整详情（包括 instructions、commands）
- `matchSkillsForChannel(channel, query, options)` - 根据频道配置匹配 Skills
- `generateSystemPromptForChannel(channel, query, options)` - 生成频道级系统提示词（支持分级加载）
  - `options.loadMode` - 加载模式：`'candidates'` | `'matched'` | `'full'`
- `executeSkillCommand(skillName, commandName, parameters)` - 执行 Skill 指令
- `listSkills()` - 获取所有可用 Skills 列表
- `reload()` - 重新加载所有 Skills

#### 分级加载相关

- `getChannelSkillCandidates(channel)` - 获取频道候选 Skills 列表（仅名称和描述）
- `generateSkillCandidatesPrompt(candidates)` - 生成候选列表提示词
- `generateSkillDetailPrompt(skillName, options)` - 生成单个 Skill 详细提示词

#### 频道配置相关

- `getChannelSkillsConfig(channel)` - 获取频道的 Skills 配置

#### 工具生成

- `generateSkillTools(skills)` - 生成 Function Calling 工具定义
- `parseSkillCalls(content)` - 解析 LLM 回复中的指令调用

### 大模型聊天集成（skillChat.js）

对于需要与大模型进行交互的场景，可以使用封装好的聊天集成模块：

```javascript
import {
    initSkillChatContext,     // 初始化 Skills 聊天上下文
    checkSkillSelection,      // 检查技能选择
    executeSkillToolCalls,    // 执行工具调用
    getSkillStats             // 获取统计信息
} from './skill/index.js'

// 1. 初始化上下文（自动加载候选列表）
const { prompt, context } = await initSkillChatContext('code_assistant', query, {
    loadMode: 'candidates'
})

// 2. 检查大模型是否选择了技能
const selectedSkill = await checkSkillSelection(llmResponse, context)
if (selectedSkill) {
    // 系统会自动加载技能详情到上下文
}

// 3. 执行工具调用（自动区分 MCP 和 Skill 工具）
const results = await executeSkillToolCalls(toolCalls, context)

// 4. 获取统计信息
const stats = getSkillStats(context)
```

### 便捷函数

```javascript
import {
    skillManager,                    // SkillManager 实例
    matchSkills,                     // 全局匹配 Skills
    matchSkillsForChannel,           // 频道级匹配
    generateSystemPromptForChannel,  // 生成系统提示词
    getChannelSkillCandidates,       // 获取频道候选 Skills
    generateSkillDetailPrompt,       // 生成 Skill 详细提示词
    listSkills,                      // 列出所有 Skills
    executeSkillCommand,             // 执行 Skill 指令
    initSkillChatContext,            // 初始化聊天上下文
    checkSkillSelection,             // 检查技能选择
    executeSkillToolCalls,           // 执行工具调用
    getSkillStats,                   // 获取统计信息
    SkillLoadMode                    // 加载模式枚举
} from './skill/index.js'
```
