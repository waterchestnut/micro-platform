FROM reg.lc.jtxuexi.com/library/python:3.12-slim-uv

WORKDIR /app

ENV PATH="/app/.venv/bin:$PATH"

# 复制项目文件到容器中
COPY . /app/

ENV PYTHONPATH=.

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"]
