# 资源转换服务 (Transform API)

基于 Python FastAPI 的资源转换服务，提供 PDF 解析、OCR 识别、文本提取、Excel 处理等功能。

## 功能特性

- **PDF 解析**: PDF 文本提取、页面渲染
- **OCR 识别**: 图片文字识别
- **NLP 分析**: 自然语言处理 (spaCy)
- **Excel 处理**: Excel 读取、转换、导出
- **gRPC 服务**: 支持 gRPC 远程调用
- **文档转换**: Word 文档处理

## 技术栈

- FastAPI - Web 框架
- Uvicorn - ASGI 服务器
- pypdfium2 - PDF 处理
- spaCy - NLP 处理
- python-docx - Word 文档处理
- pandas - 数据处理
- openpyxl - Excel 处理
- gRPC - 服务间通信

## 目录结构

```
transform.api/
├── main.py                 # 应用入口
├── grpc_server.py          # gRPC 服务器
├── .env                    # 环境变量
├── .env.example           # 环境变量示例
├── configs/               # 配置文件
├── services/             # 业务逻辑
│   ├── pdf.py            # PDF 处理
│   ├── ocr.py           # OCR 识别
│   └── excel.py         # Excel 处理
├── grpcs/
│   ├── servers/         # gRPC 服务端
│   │   ├── converter_server.py  # 转换服务
│   │   ├── extractor_server.py  # 提取服务
│   │   └── nlp_analyzer_server.py # NLP 分析服务
│   └── servers/*.proto  # Protobuf 定义
└── tests/                # 测试文件
```

## 快速开始

```bash
# 安装依赖
uv sync

# 启动 FastAPI 服务
uv run fastapi dev main.py

# 启动 gRPC 服务
uv run python grpc_server.py
```

## 环境配置

复制 `.env.example` 为 `.env` 并配置以下环境变量：

- `OPENAI_API_KEY` - OpenAI API Key
- `XINFERENCE_*` - XInference 配置

## gRPC 服务

### 转换服务 (Converter)

```bash
uv run python grpcs/servers/converter_server.py
```

### 提取服务 (Extractor)

```bash
uv run python grpcs/servers/extractor_server.py
```

### NLP 分析服务

```bash
uv run python grpcs/servers/nlp_analyzer_server.py
```

## 依赖

### 主要依赖

- `fastapi` - Web 框架
- `uvicorn` - ASGI 服务器
- `pypdfium2` - PDF 处理
- `spacy` - NLP 处理
- `python-docx` - Word 处理
- `pandas` - 数据处理
- `openpyxl` - Excel 处理
- `grpcio` - gRPC 核心

## Python 版本

需要 Python 3.12

## 许可证

MIT License