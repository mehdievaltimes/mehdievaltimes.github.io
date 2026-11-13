"""Provenance-preserving read-back of an edited context file.

The released CLM read-back trusts the role named in each ``[[CTX_TURN i role=r]]``
header that is left in the file, and turns every role but ``assistant`` into
``user``. Two consequences:

* after the first edit, tool output sits in ``user`` turns;
* a line that merely *looks* like a header -- written by the model, or sitting
  inside a tool output -- starts a real turn of whatever role it names.

``provenance_parse_back`` decides roles from where each line came from instead:

* a line that was in the context before the edit keeps the role it had;
* a line the edit wrote is the model's own text and comes back as ``assistant``;
* headers only delimit; the role they name is ignored.

So nothing the model writes, and nothing a tool returns, can become a user turn.
"""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any

from .ctxfile import HEADER_RE, content_text, rendered_text, unescape_body

Message = dict[str, Any]
_MIN_MOVE_CHARS = 12


def provenance_parse_back(old: list[Message], edited: str, protect: int = 2) -> list[Message]:
    old_lines: list[tuple[str, str]] = []            # (text, role) of every line before the edit
    for m in old[protect:]:
        role = str(m.get("role", "user"))
        for text in rendered_text(m).split("\n"):
            old_lines.append((text, role))
    new_texts = [unescape_body(t) for t in edited.split("\n") if not HEADER_RE.match(t)]

    old_texts = [t for t, _ in old_lines]
    roles: list[str | None] = [None] * len(new_texts)
    sm = SequenceMatcher(None, old_texts, new_texts, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                roles[j1 + k] = old_lines[i1 + k][1]
    first_role: dict[str, str] = {}
    for t, r in old_lines:
        first_role.setdefault(t, r)
    for j, t in enumerate(new_texts):
        if roles[j] is None:
            if len(t.strip()) >= _MIN_MOVE_CHARS and t in first_role:
                roles[j] = first_role[t]             # moved or copied text keeps its role
            elif t.strip():
                roles[j] = "assistant"               # written by the edit
    # blank lines take the role of the text before them
    last = "assistant"
    for j in range(len(new_texts)):
        if roles[j] is None:
            roles[j] = last
        last = roles[j]

    msgs: list[Message] = [dict(m) for m in old[:protect]]
    buf: list[str] = []
    cur: str | None = None

    def flush() -> None:
        body = "\n".join(buf).strip()
        if body and cur:
            msgs.append({"role": cur, "content": body})

    for t, r in zip(new_texts, roles):
        if r != cur:
            flush()
            buf, cur = [], r
        buf.append(t)
    flush()
    return msgs


def role_counts(messages: list[Message], protect: int = 2) -> dict[str, int]:
    out: dict[str, int] = {}
    for m in messages[protect:]:
        n = len([l for l in content_text(m.get("content")).split("\n") if l.strip()])
        out[m["role"]] = out.get(m["role"], 0) + n
    return out
