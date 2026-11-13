"""ctxvc: version history for self-edited LLM contexts.

Reads the per-call context snapshots a Context-Language-Model harness already
writes, and turns them into a step-by-step record: what changed, which command
changed it, what the model was thinking, and who originally wrote every line.
"""

__version__ = "0.1.0"
