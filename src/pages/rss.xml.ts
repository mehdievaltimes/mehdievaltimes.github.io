import type { APIContext } from 'astro';
import { getEntries, excerpt, href, site } from '../lib';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

// Everything in the writing feed, newest first. Untitled notes are titled by their opening words.
export async function GET({ site: origin }: APIContext) {
  const entries = await getEntries();
  const items = entries.map((e) => {
    const link = new URL(href(e), origin).href;
    const title = e.data.title ?? excerpt(e, 60);
    return `    <item>
      <title>${esc(title)}</title>
      <link>${link}</link>
      <guid>${link}</guid>
      <pubDate>${e.data.date.toUTCString()}</pubDate>
      <description>${esc(excerpt(e, 400))}</description>
${e.data.tags.map((t) => `      <category>${esc(t)}</category>`).join('\n')}
    </item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.name)}</title>
    <link>${origin}</link>
    <atom:link href="${new URL('/rss.xml', origin)}" rel="self" type="application/rss+xml" />
    <description>Writing by ${esc(site.name)}</description>
    <language>en</language>
${items.join('\n')}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
