import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// One collection for everything: long essays, half-baked notes, one-liners.
// Only `date` is required. No title? It shows up as a note in the feed.
const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    date: z.coerce.date(),
    title: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false), // visible in `npm run dev`, never published
    unlisted: z.boolean().default(false), // published at its URL, hidden from the feed
  }),
});

export const collections = { writing };
