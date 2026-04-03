---
name: res-discovery
description: 资源发现服务 - 根据关键词检索资源元数据
author: xianyang
version: 1.0.0
tags:
  - resource
  - search
  - metadata
---

# 资源发现服务

## When to Use This Skill

当用户需要根据关键词检索资源元数据信息时使用此技能。

## Instructions

- @searchResMetas[keywords:string, resType?:string, maxCount?:number] - 检索资源元数据

### searchResMetas 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keywords | string | 是 | 检索关键词 |
| resType | string | 否 | 资源类型筛选条件 |
| maxCount | number | 否 | 最大返回条数，默认10 |

### searchResMetas 返回

返回资源元数据列表，包含以下字段：

| 字段 | 说明 |
|------|------|
| resCode | 资源编码 |
| title | 资源标题 |
| abstract | 摘要 |
| category | 分类 |
| status | 状态 |
| resType | 资源类型 |
| publishDateStr | 发布日期 |
| keywords | 关键词 |
| language | 语言 |
| journalTitle | 期刊标题 |
| issues | 期次 |
| publisher | 出版社 |
| author | 作者 |

## Examples

示例：检索关键词为"人工智能"的资源元数据

```
@searchResMetas[keywords:人工智能]
```

带筛选条件的检索：

```
@searchResMetas[keywords:人工智能, resType:期刊, maxCount:20]
```
