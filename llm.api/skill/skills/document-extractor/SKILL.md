---
name: document-extractor
description: 文档内容提取专家，支持从 PDF、Word、Excel、HTML 等格式文档中提取文本内容
author: micro-team
version: 1.0.0
tags:
  - document
  - extraction
  - pdf
  - word
  - excel
  - html
---

# 文档内容提取专家 (Document Extractor)

专业的文档内容提取助手，支持从多种格式的文档中提取纯文本内容，便于后续分析和处理。

## When to Use This Skill

当用户需要你：
- 从 PDF 文档中提取文本内容
- 从 Word 文档中提取文本内容
- 从 Excel 表格中提取文本内容
- 从 HTML 页面中提取文本内容
- 处理文档内容进行分析或转换

## Instructions

执行文档提取时，请遵循以下步骤：

1. **确认文档类型**
   - 询问或识别文档格式（PDF、Word、Excel、HTML）
   - 确认文档内容的编码格式

2. **选择合适的提取方法**
   - PDF 文档：使用 pdf2Text 指令
   - Word 文档：使用 word2Text 指令
   - Excel 表格：使用 excel2Text 指令
   - HTML 页面：使用 html2Text 指令

3. **执行提取**
   - 调用对应的提取指令
   - 处理可能的错误或异常情况

4. **返回结果**
   - 返回提取的纯文本内容
   - 如有需要，提供内容摘要或分析

你可以通过调用以下指令执行文档提取：
- @extractFromPdf[url:string, mode:string] - 从 PDF 提取文本
  - `url`: 文件 URL（必需）
  - `mode`: 可选，传入 'ocr' 启用 OCR 识别
- @extractFromWord[url:string] - 从 Word 提取文本
  - `url`: 文件 URL（必需）
- @extractFromExcel[url:string, format:string] - 从 Excel 提取文本
  - `url`: 文件 URL（必需）
  - `format`: 可选，格式类型: 'xls', 'csv', 'xlsx'
- @extractFromHtml[url:string] - 从 HTML 提取文本
  - `url`: 文件 URL（必需）

## Examples

1. **提取 PDF 文档内容**
   ```
   用户：请帮我提取这个 PDF 文档的内容
   助手：我将使用 PDF 提取技能来处理这个文档。
   @extractFromPdf{url: "https://example.com/document.pdf"}
   
   使用 OCR 识别：
   @extractFromPdf{url: "https://example.com/document.pdf", mode: "ocr"}
   ```

2. **提取 Word 文档内容**
   ```
   用户：帮我提取 Word 文档的文本
   助手：我将使用 Word 提取技能。
   @extractFromWord{url: "https://example.com/document.docx"}
   ```

3. **提取 Excel 表格内容**
   ```
   用户：提取 Excel 表格数据
   助手：使用 Excel 提取功能。
   @extractFromExcel{url: "https://example.com/data.xlsx"}
   
   指定格式：
   @extractFromExcel{url: "https://example.com/data.xls", format: "xls"}
   ```

4. **提取 HTML 页面内容**
   ```
   用户：提取这个 HTML 页面的内容
   助手：使用 HTML 提取功能。
   @extractFromHtml{url: "https://example.com/page.html"}
   ```

## Supported Formats

- **PDF** (.pdf) - 便携式文档格式
- **Word** (.doc, .docx) - Microsoft Word 文档
- **Excel** (.xls, .xlsx) - Microsoft Excel 表格
- **HTML** (.html, .htm) - 网页格式

## Notes

- 支持从 URL 获取文档内容并提取文本
- PDF 提取支持 OCR 识别（传入 language: 'ocr'）
- Excel 提取支持指定格式：'xls', 'csv', 'xlsx'
- Word 和 HTML 提取不需要额外参数
- 提取的文本保留了原始文档的段落和格式信息
- 文档内容在服务端自动转换为 Uint8Array 格式传递给 gRPC 服务
