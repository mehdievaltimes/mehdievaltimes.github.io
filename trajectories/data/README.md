# data

Agent runs shown at [/trajectories](https://mehdievaltimes.github.io/trajectories/). A run is a result `.json` plus its event stream `.jsonl`, paired by name: `x.json` goes with `x.jsonl` or `x_reasoning.jsonl` (also `_trajectory`, `_transcript`, `_events`), or with whatever file the JSON's `reasoning_file` names. Either file alone also works.

```
data/
  revopt/                      a collection: one section on the page
    README.md                  its description; a leading "# Title" names the section
    run1.json                  result
    run1_reasoning.jsonl       event stream  → /trajectories/revopt/run1/
    run1.md                    optional notes, shown first on the run's page
  loose-run.jsonl              runs outside a folder are listed under "Other runs"
```

Each collection gets a per-model summary (runs, solved, mean score, median steps and wall time, total cost) built from the result files. Every run page also has an Analysis tab computed from the stream: programs and tools used, exit codes, files edited.

Streams from Codex CLI (`codex exec --json`), Claude Code and Cursor (`stream-json`), Antigravity, and chat-message JSON are understood; anything else shows as raw events. Streams over 1 MB are gzipped when the site is built, so upload them as they are. Files here are public: check them for home-directory paths, tokens or anything private first.
