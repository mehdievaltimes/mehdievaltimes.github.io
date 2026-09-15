import { getCollection, type CollectionEntry } from 'astro:content';

export type Kind = 'posts' | 'thoughts';
export type Entry = CollectionEntry<Kind>;

export const site = {
  name: 'Mehdi Shakibapour',
  short: 'mehdi',
  description: 'Counter-intuitive ideas, math, interpretability, and whatever else is on my mind.',
  repo: 'mehdievaltimes/mehdievaltimes.github.io',
};

export const words = (e: Entry) => (e.body ?? '').split(/\s+/).filter(Boolean).length;
export const readingTime = (e: Entry) => `${Math.max(1, Math.round(words(e) / 230))} min`;
export const href = (e: Entry) => `/${e.collection}/${e.id}/`;

export async function getEntries<K extends Kind>(kind: K, { includeUnlisted = false } = {}) {
  const all = await getCollection(kind, ({ data }: Entry) =>
    (import.meta.env.DEV || !data.draft) && (includeUnlisted || !data.unlisted),
  );
  return (all as Entry[]).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf()) as CollectionEntry<K>[];
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
