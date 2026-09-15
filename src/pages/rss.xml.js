import rss from '@astrojs/rss';
import { getEntries, site, excerpt, href } from '../lib';

export async function GET(context) {
  const entries = [...(await getEntries('posts')), ...(await getEntries('thoughts'))].sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );
  return rss({
    title: site.name,
    description: site.description,
    site: context.site,
    items: entries.map((e) => ({
      title: e.data.title ?? excerpt(e, 60),
      pubDate: e.data.date,
      description: excerpt(e, 400),
      link: href(e),
    })),
  });
}
