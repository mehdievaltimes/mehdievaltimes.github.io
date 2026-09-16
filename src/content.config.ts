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

// Weekly reading list: one file per week, used as a directory of what I owe myself.
const reading = defineCollection({
  loader: glob({ pattern: '**/*.{md,yml,yaml}', base: './src/content/reading' }),
  schema: z.object({
    week: z.number().optional(), // omit for a whole-course list
    title: z.string().optional(), // shown instead of "Week N"
    starts: z.coerce.date().optional(),
    course: z.string().optional(),
    order: z.number().default(0), // higher sorts first
    note: z.string().optional(),
    items: z.array(
      z.object({
        title: z.string(),
        author: z.string().optional(),
        url: z.string().optional(),
        course: z.string().optional(),
        note: z.string().optional(),
        optional: z.boolean().default(false),
      }),
    ).default([]),
  }),
});

export const collections = { writing, reading };
