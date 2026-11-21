import logging
import os

import httpx

# The local model on the homelab, run by Ollama in its own container.
# From inside this container, host.docker.internal is the homelab itself
# (see extra_hosts in docker-compose.yml).
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:4b-instruct-8k")

# The model runs on the CPU: loading it takes up to ~15 s and it writes about
# 10 tokens a second, so allow plenty of time. Callers never wait on this
# from a request; it runs in background tasks.
TIMEOUT_SECONDS = 180

log = logging.getLogger("uvicorn.error")


def generate(system: str, prompt: str, max_tokens: int = 120) -> str | None:
    # One question, one answer. Returns None instead of raising, so a missing
    # or slow model only means a missing AI feature, never a broken dashboard.
    try:
        response = httpx.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                # Low temperature: stick closely to the facts it's given.
                # num_predict caps the answer's length (and so how long it runs).
                "options": {"temperature": 0.3, "num_predict": max_tokens},
            },
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        text = response.json()["message"]["content"].strip()
        return text or None
    except (httpx.HTTPError, KeyError, ValueError) as err:
        log.warning("LLM request failed: %r", err)
        return None
