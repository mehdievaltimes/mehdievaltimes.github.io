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
