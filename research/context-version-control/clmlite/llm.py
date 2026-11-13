"""Model backends: a headless Claude call per completion, and a scripted stand-in."""

from __future__ import annotations

import json
import random
import subprocess
import tempfile
import threading
import time
from typing import Any


class LLMError(RuntimeError):
    pass


class ClaudeCLI:
    """One ``claude -p`` call per completion: no tools, no session, custom system prompt.

    The whole context goes in as one user message. Sampling settings are whatever
    the CLI uses; it does not expose temperature, so replays are stochastic.
    """

    def __init__(self, model: str = "haiku", timeout: int = 300, retries: int = 4):
        self.model = model
        self.timeout = timeout
        self.retries = retries
        self._cwd = tempfile.mkdtemp(prefix="clmlite-llm-")
        self._lock = threading.Lock()
        self.calls = 0
        self.cost_usd = 0.0
        self.input_tokens = 0
        self.output_tokens = 0

    def complete(self, system: str, prompt: str) -> dict[str, Any]:
        cmd = ["claude", "-p", "--model", self.model, "--tools", "", "--system-prompt", system,
               "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
               "--setting-sources", "", "--output-format", "json"]
        last = ""
        for attempt in range(self.retries):
            try:
                p = subprocess.run(cmd, input=prompt, capture_output=True, text=True,
                                   timeout=self.timeout, cwd=self._cwd)
                d = json.loads(p.stdout)
                if d.get("is_error") or d.get("type") != "result":
                    raise LLMError(str(d.get("result") or d)[:400])
                u = d.get("usage") or {}
                tin = (u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
                       + u.get("cache_read_input_tokens", 0))
                out = {"text": d.get("result") or "", "input_tokens": tin,
                       "output_tokens": u.get("output_tokens", 0),
                       "cost_usd": d.get("total_cost_usd", 0.0),
                       "model": next(iter(d.get("modelUsage") or {}), self.model)}
                with self._lock:
                    self.calls += 1
                    self.cost_usd += out["cost_usd"] or 0.0
                    self.input_tokens += tin
                    self.output_tokens += out["output_tokens"]
                return out
            except (subprocess.TimeoutExpired, json.JSONDecodeError, LLMError) as exc:
                last = f"{type(exc).__name__}: {str(exc)[:300]}"
                time.sleep(min(60, 3 * 2 ** attempt) * (0.5 + random.random()))
        raise LLMError(f"model call failed after {self.retries} attempts: {last}")


def rate_limit_utilization(model: str = "haiku") -> dict[str, Any]:
    """One tiny call in stream mode, to read the account's rate-limit window utilisation."""
    cmd = ["claude", "-p", "--model", model, "--tools", "", "--system-prompt", "Reply OK.",
           "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
           "--setting-sources", "", "--output-format", "stream-json", "--verbose"]
    p = subprocess.run(cmd, input="OK", capture_output=True, text=True, timeout=120,
                       cwd=tempfile.mkdtemp(prefix="clmlite-llm-"))
    for line in p.stdout.splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("type") == "rate_limit_event":
            info = d.get("rate_limit_info") or {}
            return {k: {"utilization": v.get("utilization")} for k, v in (info.get("unifiedWindows") or {}).items()} \
                | {"status": info.get("status")}
    return {}


class ScriptedLLM:
    """Replays a fixed list of replies; for tests."""

    def __init__(self, replies: list[str]):
        self.replies = list(replies)
        self.calls = 0
        self.cost_usd = 0.0
        self.prompts: list[str] = []

    def complete(self, system: str, prompt: str) -> dict[str, Any]:
        self.prompts.append(prompt)
        text = self.replies[min(self.calls, len(self.replies) - 1)]
        self.calls += 1
        return {"text": text, "input_tokens": len(prompt) // 3, "output_tokens": len(text) // 3,
                "cost_usd": 0.0, "model": "scripted"}
