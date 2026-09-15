# mehdievaltimes.github.io

Built with [Astro](https://astro.build). Deploys to GitHub Pages on push to `main`.

```sh
npm install
npm run dev      # http://localhost:4321
```

## Writing

Two kinds of content, two folders:

- `src/content/posts/` — written-out pieces. Needs `title` and `date`.
- `src/content/thoughts/` — anything short or half-formed. Only `date` is required.

```md
---
date: 2026-09-14
---

the whole thing can just be one sentence.
```

- `draft: true` → visible only in `npm run dev`. Nothing leaves your machine.
- `unlisted: true` → published at its URL but not in lists or RSS.
- Math works: `$x^2$` and `$$\int f$$`.

**From the browser:** go to `/thoughts/new`, write, hit publish. It opens GitHub's "new file" page
prefilled; commit it and the site redeploys. (The page is public but does nothing without push access to the repo.)

**From the terminal:**

```sh
npm run new                              # blank thought
npm run new -- --now "a quick thought"   # thought with text in it
npm run new -- --post "On Tokenization"  # post
npm run new -- --draft --post "Hot take" # draft
```

`src/pages/now.md` is the "what I'm doing now" page.

No comments, no view counts, no likes.
