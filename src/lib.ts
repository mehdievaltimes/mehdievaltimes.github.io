import { getCollection, type CollectionEntry } from 'astro:content';

export type Entry = CollectionEntry<'writing'>;

export const site = {
  name: 'Mehdi Shakibapour',
  short: 'mehdi',
  description: 'Counter-intuitive ideas, math, interpretability, and whatever else is on my mind.',
};

// A post is "short" if it reads fine inline in the feed.
const SHORT_WORDS = 180;

export const words = (e: Entry) => (e.body ?? '').split(/\s+/).filter(Boolean).length;
export const isShort = (e: Entry) => !e.data.title || words(e) <= SHORT_WORDS;
export const readingTime = (e: Entry) => `${Math.max(1, Math.round(words(e) / 230))} min`;

export async function getEntries({ includeUnlisted = false } = {}) {
  const all = await getCollection('writing', ({ data }) =>
    (import.meta.env.DEV || !data.draft) && (includeUnlisted || !data.unlisted),
  );
  return all.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function excerpt(e: Entry, n = 240) {
  const text = (e.body ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > n ? text.slice(0, n).replace(/\s\S*$/, '') + '…' : text;
}

export const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
