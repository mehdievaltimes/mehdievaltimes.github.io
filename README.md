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

No comments, no view counts, no likes.
