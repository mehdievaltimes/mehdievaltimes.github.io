"""One-file HTML viewer of a run: every step with its thought, command, diff and provenance."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from .blame import History

_TEMPLATE = Path(__file__).with_name("view_template.html")


def view_data(h: History, title: str | None = None, max_obs: int = 3000) -> dict[str, Any]:
    texts: dict[str, int] = {}
    roles: dict[str, int] = {}

    def t(s: str) -> int:
        return texts.setdefault(s, len(texts))

    def r(s: str) -> int:
        return roles.setdefault(s, len(roles))

    def line(l) -> list:
        return [t(l.text), l.origin, r(l.role), [o for o, _ in l.derived]]

    steps = []
    for tr in h.transitions:
        obs = tr.observation or ""
        if len(obs) > max_obs:
            obs = obs[: max_obs // 2] + f"\n… {len(obs) - max_obs} characters not shown …\n" + obs[-max_obs // 2:]
        relabel = Counter(f"{old.role}→{new}" for old, new in tr.relabeled)
        steps.append({"call": tr.call, "kind": tr.kind, "tb": tr.tokens_before, "ta": tr.tokens_after,
                      "thought": tr.thought, "command": tr.command, "exit": tr.exit_code, "obs": obs,
                      "events": tr.events, "removed": [line(l) for l in tr.removed],
                      "written": [line(l) for l in tr.written], "moved": tr.moved,
                      "relabel": dict(relabel)})
    versions = [{"call": v.call, "kind": v.kind, "tokens": v.tokens,
                 "lines": [[t(l.text), l.origin, r(l.role), [o for o, _ in l.derived], l.msg] for l in v.lines]}
                for v in h.versions]
    meta = dict(h.run.meta)
    res = h.run.result or {}
    return {
        "title": title or meta.get("task") or h.run.dir.name,
        "meta": {"task": meta.get("task"), "model": meta.get("model"), "limit": meta.get("limit"),
                 "condition": meta.get("condition"),
                 "result": {k: res.get(k) for k in ("reward", "correct", "total", "terminated_by", "phase1_reward")
                            if k in res}},
        "texts": list(texts), "roles": list(roles),
        "origins": [{"l": o.label(), "w": o.writer, "s": o.step} for o in h.origins],
        "steps": steps, "versions": versions, "protect": h.protect,
    }


def render_view(h: History, title: str | None = None, standalone: bool = False) -> str:
    data = json.dumps(view_data(h, title), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = _TEMPLATE.read_text(encoding="utf-8").replace("/*__RUN_DATA__*/null", data)
    if standalone:
        page = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>'
                + page + "</body></html>")
    return page


def write_view(h: History, out: Path | str, title: str | None = None, standalone: bool = True) -> None:
    Path(out).write_text(render_view(h, title, standalone), encoding="utf-8")
