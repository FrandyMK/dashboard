# Match this to requires-python in pyproject.toml (e.g. >=3.14 → 3.14)
FROM python:3.12-slim

# Match this to your local `uv --version`
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /uvx /bin/

WORKDIR /app

# Dependencies first: this layer is cached and only rebuilds
# when pyproject.toml or uv.lock change, not on every code edit.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY *.py ./

ENV PATH="/app/.venv/bin:$PATH"
ENV DASHBOARD_DB=/data/dashboard.db
EXPOSE 8000

CMD ["fastapi", "run", "main.py", "--port", "8000"]
