# mehdievaltimes.github.io

Built with [Astro](https://astro.build). Deploys to GitHub Pages on push to `main`.

```sh
npm install
npm run dev      # http://localhost:4321
```

## Posting

Everything lives in `src/content/writing/`. There is no difference between a "post" and a "tweet":
one Markdown file, one required field.

```md
---
date: 2026-09-14
---

the whole thing can just be one sentence.
```

- **No title** → it shows up in the feed in full, like a tweet.
- **Title + short body** (≤180 words) → also shown in full.
- **Title + long body** → shown as title + excerpt, links to its page.
- `draft: true` → visible only in `npm run dev`. Nothing leaves your machine.
- `unlisted: true` → published at its URL (share it with whoever) but not in the feed or RSS.
- Math works: `$x^2$` and `$$\int f$$`.

Shortcuts:

```sh
npm run new                          # blank untitled note
npm run new "On Tokenization"        # titled post
npm run new -- --draft "Hot take"    # draft
npm run new -- --now "a quick thought"  # note with the text already in it
```

No comments, no view counts, no likes. Edit or delete anything whenever; old URLs under `/posts/<slug>/` keep working as long as the filename does.
