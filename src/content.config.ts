import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const common = {
  date: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false), // visible in `npm run dev`, never published
  unlisted: z.boolean().default(false), // published at its URL, hidden from lists & RSS
};

// Posts: written-out pieces. Title required.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({ ...common, title: z.string() }),
});

// Thoughts: anything short or half-formed. Title optional.
const thoughts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/thoughts' }),
  schema: z.object({ ...common, title: z.string().optional() }),
});

export const collections = { posts, thoughts };
