FROM reg.lc.jtxuexi.com/library/python:3.12-slim-uv

WORKDIR /app

ENV PATH="/app/.venv/bin:$PATH"

ENV PYTHONPATH=.

# 安装中文字体（渲染服务视频内中文标题/caption需要，matplotlib按font.family回退链取Noto Sans CJK SC）
RUN apt-get update && \
    apt-get install -y --no-install-recommends fonts-noto-cjk && \
    rm -rf /var/lib/apt/lists/*

# 复制依赖文件到容器中
COPY uv.lock pyproject.toml /app/
RUN ls -la && \
    uv sync --no-install-project

# 复制项目文件到容器中
COPY . /app/
RUN uv sync

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80", "--log-level", "warning"]
