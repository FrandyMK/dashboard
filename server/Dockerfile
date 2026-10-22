# --- Stage 1: build the frontend ---
# Match this to your local `node --version` major number.
FROM node:24-slim AS frontend
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Stage 2: the API, plus the built frontend ---
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /uvx /bin/

WORKDIR /app

COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY server/*.py ./
COPY --from=frontend /web/dist ./static

ENV PATH="/app/.venv/bin:$PATH"
ENV DASHBOARD_DB=/data/dashboard.db
EXPOSE 8000

CMD ["fastapi", "run", "main.py", "--port", "8000"]
