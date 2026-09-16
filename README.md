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

`src/pages/now.md` is the "what I'm doing now" page.

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
