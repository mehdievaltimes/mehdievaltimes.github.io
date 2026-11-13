"""The context-as-a-file format, and a token estimate.

The editable part of a conversation is written to a text file, one block per turn::

    [[CTX_TURN 1 role=user]]
    <text of the turn>

    [[CTX_TURN 2 role=assistant]]
    <text of the turn>

The model edits that file with ordinary shell tools; ``parse_back`` maps whatever
it left behind onto a legal message list again.

The format and the parse-back rules follow the released Context Language Models
harness (facebookresearch/context-language-models, ``clm_harness/context_utils/
context_string.py``, CC BY-NC 4.0), re-implemented here from its documented
behaviour so that logs from either harness can be read by the same tools:

* the first ``protect`` messages (system prompt and task) are pinned and never
  appear in the file;
* whatever ``[[CTX_TURN i role=r]]`` headers survive define the turns; the number
  is display-only;
* text before the first header becomes a ``user`` turn;
* emptied turns are dropped and consecutive turns of the same role are merged;
* with ``fold_roles=True`` (the released behaviour) every role other than
  ``assistant`` comes back as ``user``.  ``fold_roles=False`` keeps the role the
  header names, which is what a provenance-preserving harness wants.
"""

from __future__ import annotations

import json
import re
from typing import Any

HEADER_RE = re.compile(r"^\[\[CTX_TURN\s+(\d+)\s+role=([A-Za-z]+)\]\]\s*$", re.M)
VALID_ROLES = {"system", "user", "assistant", "tool"}

Message = dict[str, Any]


def est_tokens(text: str) -> int:
    """Token estimate used as the budget ruler everywhere: one token per 3 characters.

    The tokenizer vocabularies are not reachable from every environment, and the
    budget only has to be consistent, not exact. Real usage is logged per call.
    """
    return (len(text) + 2) // 3


def content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "".join(parts)
    return "" if content is None else str(content)


def rendered_text(msg: Message) -> str:
    """The text of one turn as it appears in the file: reasoning, content, then the
    issued tool call (name and arguments), so a turn's command is part of its text."""
    parts: list[str] = []
    rc = msg.get("reasoning_content")
    if isinstance(rc, str) and rc:
        parts.append(rc)
    ct = content_text(msg.get("content"))
    if ct:
        parts.append(ct)
    for tc in msg.get("tool_calls") or []:
        fn = (tc or {}).get("function") or {}
        args = fn.get("arguments")
        if not isinstance(args, str):
            try:
                args = json.dumps(args or {})
            except Exception:
                args = ""
        piece = f"{fn.get('name', '')} {args}".strip()
        if piece:
            parts.append(piece)
    return "\n".join(p for p in parts if p)


def messages_tokens(messages: list[Message]) -> int:
    return sum(est_tokens(rendered_text(m)) + 4 for m in messages)


def render(messages: list[Message], protect: int = 2) -> str:
    """Render the editable region (messages after the pinned prefix) to file text."""
    blocks = []
    for n, m in enumerate(messages[protect:], start=1):
        blocks.append(f"[[CTX_TURN {n} role={m.get('role', 'user')}]]\n{rendered_text(m)}")
    return "\n\n".join(blocks)


def parse_back(text: str, protected: list[Message], *, fold_roles: bool = True) -> list[Message]:
    """Map an arbitrarily edited file back to a legal message list."""
    matches = list(HEADER_RE.finditer(text))
    sections: list[tuple[str, str]] = []
    if not matches:
        body = text.strip()
        if body:
            sections.append(("user", body))
    else:
        lead = text[: matches[0].start()].strip()
        if lead:
            sections.append(("user", lead))
        for k, mt in enumerate(matches):
            role = mt.group(2).lower()
            if role not in VALID_ROLES:
                role = "user"
            end = matches[k + 1].start() if k + 1 < len(matches) else len(text)
            body = text[mt.end():end].strip()
            if body:
                sections.append((role, body))

    msgs: list[Message] = [dict(m) for m in protected]
    for role, body in sections:
        if fold_roles:
            role = "assistant" if role == "assistant" else "user"
        elif role == "system":
            role = "user"  # a system turn can never be minted by an edit
        msgs.append({"role": role, "content": body})

    merged: list[Message] = []
    for i, m in enumerate(msgs):
        if (i > len(protected) and merged and len(merged) > len(protected)
                and merged[-1].get("role") == m.get("role")
                and m.get("role") in ("user", "assistant", "tool")):
            prev = content_text(merged[-1].get("content"))
            merged[-1] = {"role": m["role"], "content": (prev + "\n\n" + content_text(m.get("content"))).strip()}
        else:
            merged.append(m)
    return merged
