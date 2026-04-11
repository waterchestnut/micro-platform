FROM reg.lc.jtxuexi.com/library/python:3.12-slim-uv

WORKDIR /app

ENV PATH="/app/.venv/bin:$PATH"

ENV PYTHONPATH=.

# 复制依赖文件到容器中
COPY uv.lock pyproject.toml /app/
RUN ls -la && \
    uv sync --no-install-project

# 复制项目文件到容器中
COPY . /app/
RUN uv sync

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"]
