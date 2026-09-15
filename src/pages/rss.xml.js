import rss from '@astrojs/rss';
import { getEntries, site, excerpt } from '../lib';

export async function GET(context) {
  const entries = await getEntries();
  return rss({
    title: site.name,
    description: site.description,
    site: context.site,
    items: entries.map((e) => ({
      title: e.data.title ?? excerpt(e, 60),
      pubDate: e.data.date,
      description: excerpt(e, 400),
      link: `/posts/${e.id}/`,
    })),
  });
}
