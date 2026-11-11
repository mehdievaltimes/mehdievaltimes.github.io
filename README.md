# mehdievaltimes.github.io

Built with [Astro](https://astro.build). Deploys to GitHub Pages on push to `main`.

```sh
npm install
npm run dev      # http://localhost:4321
```

## Writing

Everything lives in `src/content/writing/`. There is no difference between a "post" and a "thought":
one Markdown file, one required field.

```md
---
date: 2026-09-16
---

the whole thing can just be one sentence.
```

- **No title** → shows up in the feed in full, like a tweet.
- **Title + short body** (≤180 words) → also shown in full.
- **Title + long body** → title and excerpt, links to its own page at `/posts/<slug>/`.
- `draft: true` → visible only in `npm run dev`. Nothing leaves your machine.
- `unlisted: true` → published at its URL but not in the feed.
- Math works: `$x^2$` and `$$\int f$$`.

**From the browser:** go to `/new`, write, hit publish. It opens GitHub's "new file" page prefilled;
commit it and the site redeploys. (The page is public but does nothing without push access to the repo.)

**From the terminal:**

```sh
npm run new                              # blank note
npm run new -- --now "a quick thought"   # note with text in it
npm run new "On Tokenization"            # titled piece
npm run new -- --draft "Hot take"        # draft
```

## Reading list

One file per section in `src/content/reading/`, shown at `/reading`. Sections sort by `order` (highest first).
Checkboxes are remembered per browser; the filter and hide-read state live in the URL, so a filtered view is shareable.

```yml
# src/content/reading/week-03.yml
week: 3          # or title: "Some section name"
starts: 2026-09-22
kind: course     # or self (default) — shown as a chip
order: 10
note: optional one-liner about the week
items:
  - title: Attention Is All You Need
    author: Vaswani et al.
    url: https://arxiv.org/abs/1706.03762
    course: Computation and the Brain
    note: skim the encoder-decoder diagram
    optional: false
```

Only `title` is required on an item; only `week` and `starts` on the week.

No comments, no view counts, no likes.

## Terminal (homepage)

`src/components/Terminal.astro` is a small fake shell. `~/writing` and `~/reading` are built from the content
collections at build time (coursework stays out, same as `/reading`), so posts can be `cat`ed, grepped and `open`ed.
Its machine (homes, `/etc`, the repo in `~/.ctf`) is in `src/components/terminal/fs.ts`; the 8-ball, man pages
and logo are in `terminal/text.ts`. History and the motd are kept per browser in `localStorage`. `mail mehdi` builds the address only when run.

## CTF (`/ctf`)

Six challenges: the terminal's autograder (git), plus forensics, web, crypto, reversing and ML. Their files
are in `public/ctf/`; `src/data/ctf.json` holds the SHA-256 of each flag and the sealed-export blob. The page
checks flags in the browser and keeps progress in `localStorage`. The autograder's hash is the terminal's
own `ANSWER_SHA256`, so a solve in either place counts in both.

The scripts that made the challenge files contain the flags, so they are deliberately not in this repo. To
change a flag, regenerate that challenge's file and its hash together.

## Paper trading (`/trading`)

AI models trade real [Kalshi](https://kalshi.com) markets with fake money. The harness is `scripts/kalshi/`:
`kalshi.mjs` reads Kalshi's public market data (no account or key), `agents.mjs` asks a model for a probability
through its agent CLI, `book.mjs` holds the rules (which markets, what a forecast buys, fees, settling) and
`trade.mjs` runs a round. The ledger is `src/data/kalshi-paper.json`; the page is built from it.

```sh
npm run trade:round                                                           # settle, then a round: Claude Sonnet + the coin flip
npm run trade -- --models claude-opus-5-5,gpt-6-sol,grok-4.7-medium,random   # the same with other traders
npm run trade -- --settle                                                     # only settle and re-mark
npm run trade:test                                                            # the book's unit tests
```

Models route like puppy bench (`claude-*` to Claude Code, `*grok*`/`*gemini*` to Cursor, the rest to Codex), and
`random` is the coin-flip control. Run it about once a day, then commit the ledger. Nothing in the harness can
place a real order: it only ever sends GET requests.

### Our own model (`scripts/kalshi/house/`)

`backfill.py` builds a training set from Kalshi's public history (settled markets since the live-data cutoff,
with the bid/ask, open interest and past day's volume each had 6, 24 and 72 hours before it closed; about
90 minutes, written to the git-ignored `data/kalshi/`). `train.py` fits a small correction to the price on the
older closes, tests it on the later ones, and writes `scripts/kalshi/house-model.json`, which `--models house`
trades on.

Result, Nov 2026 (69k rows, 29k markets, 183 series, closes Sep 12 to Nov 10): **it did not pass**. Prices were
already accurate at every horizon (24 hours out, contracts near 15¢ paid out 13.4% of the time, near 57¢
56.7%, near 95¢ 95.6%). On the held-out period the correction never found a 5¢ edge after fees, so it made no
trades, and it forecast no better than the raw price. The same holds for markets that were thin at the time
(`--max-oi 200`: open interest under 200 at the snapshot). A coin-flip taker lost 7 to 13% of its stakes to
the spread and fees. So `house` is not in the standard round.

A mistake worth remembering: the first two runs chose markets by their final lifetime volume. That depends on
how a market resolved (a longshot that comes alive gets traded heavily), so it leaks the outcome. Choosing
"thin" markets that way produced a 17 to 20% simulated return that was purely this artifact. The scripts no
longer offer that selection; thinness is measured by what was known at the snapshot.

## Induction-head demo (`/demos`, section 4)

A two-layer, attention-only transformer that runs in the browser (`public/js/induction.js`), with weights in
`public/models/induction-2l.json`. To retrain it:

```sh
pip install jax optax numpy
python scripts/induction/train.py
```

## SIGSEGV board (`/sigsegv`)

Unlisted page that lists every pull request on the COMS W4181 course forks (`scripts/fetch-sigsegv.mjs`
-> `public/sigsegv.json`). The snapshot is rebuilt on every deploy; `sigsegv-refresh.yml` polls every
10 minutes and redeploys only when the PR data changed. The page also does one live GitHub search on
load, so new PRs show up before the next deploy. Marks and filters live in `localStorage`.

```sh
GH_TOKEN=... node scripts/fetch-sigsegv.mjs   # token optional; unauthenticated is limited to 60 calls/hour
```

## Puppy bench (`/puppy-bench`)

The harness and results live in [mehdievaltimes/puppy-bench](https://github.com/mehdievaltimes/puppy-bench).
Every deploy pulls its `results/` into `src/data/puppy-bench.json` and `public/puppy-bench/runs/`; if the
clone fails, the committed copy is used. To update the committed copy by hand:

```sh
npm run puppy-bench:sync                   # from GitHub
npm run puppy-bench:sync -- ../puppy-bench # from a local checkout
```

The link-preview cards (`public/img/og.png` for the site, `public/img/og-puppy-bench.png` for the bench)
are rendered by `scripts/og.mjs`. The bench card shows the current results, so rerun it after new runs:

```sh
npm run og
```
